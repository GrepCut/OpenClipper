use base64::Engine;
use ffmpeg_next as ffmpeg;
use ffmpeg_next::format::Pixel;
use ffmpeg_next::media::Type;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, SyncSender};
use tauri::{AppHandle, Emitter};

use super::frames::ensure_ffmpeg_init;

const TARGET_BASE_HEIGHT: u32 = 120;
const JPEG_QUALITY: u8 = 70;
const INTERVAL_SEC: f64 = 1.0;
const ENCODER_WORKERS: usize = 4;
const CHANNEL_CAPACITY_PER_WORKER: usize = 40;

pub(crate) const CLIPPER_THUMBNAILS_INDEX_FILE: &str = "clip-thumbnails.json";
pub(crate) const CLIPPER_THUMBNAILS_PACK_FILE: &str = "clip-thumbnails.ndjson";
const CLIPPER_TRIMMED_SEGMENT_FILE: &str = "clip-trimmed.mp4";
pub(crate) const STUDIO_THUMBNAILS_PROGRESS_EVENT: &str = "studio-thumbnails-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioThumbnailsProgressEvent {
    pub project_id: String,
    pub done: usize,
    pub total: usize,
    pub ratio: f64,
}

fn emit_thumbnails_progress(
    app: Option<&AppHandle>,
    project_id: &str,
    done: usize,
    total: usize,
) {
    let Some(app) = app else {
        return;
    };
    let total = total.max(1);
    let done = done.min(total);
    let _ = app.emit(
        STUDIO_THUMBNAILS_PROGRESS_EVENT,
        StudioThumbnailsProgressEvent {
            project_id: project_id.to_string(),
            done,
            total,
            ratio: done as f64 / total as f64,
        },
    );
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailsIndexFrame {
    t: f64,
    file: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailsIndex {
    version: u32,
    interval_sec: f64,
    height: u32,
    format: &'static str,
    pack_file: String,
    cover_file: String,
    frames: Vec<ThumbnailsIndexFrame>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbPackLine<'a> {
    t: f64,
    jpeg: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractClipperStudioThumbnailsResult {
    pub index_file_name: String,
    pub pack_file_name: String,
    pub interval_sec: f64,
    pub height: u32,
    pub count: usize,
}

fn thumb_file_name(index: usize) -> String {
    format!("thumb-{index:04}.jpg")
}

fn is_studio_thumb_file(name: &str) -> bool {
    if name == CLIPPER_THUMBNAILS_INDEX_FILE || name == CLIPPER_THUMBNAILS_PACK_FILE {
        return true;
    }
    let Some(rest) = name.strip_prefix("thumb-") else {
        return false;
    };
    let Some(digits) = rest.strip_suffix(".jpg") else {
        return false;
    };
    digits.len() == 4 && digits.chars().all(|c| c.is_ascii_digit())
}

fn clear_existing_studio_thumbs(data_dir: &Path) -> Result<(), String> {
    if !data_dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(data_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if is_studio_thumb_file(name_str) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

fn setup_decoder(
    ictx: &ffmpeg::format::context::Input,
) -> Result<(usize, f64, ffmpeg::decoder::Video), String> {
    let input_stream = ictx
        .streams()
        .best(Type::Video)
        .ok_or("No video stream found")?;
    let stream_index = input_stream.index();
    let time_base = input_stream.time_base();
    let time_base_f64 = time_base.numerator() as f64 / time_base.denominator() as f64;
    let context_decoder = ffmpeg::codec::context::Context::from_parameters(input_stream.parameters())
        .map_err(|e| format!("Failed to create codec context: {e}"))?;
    let decoder = context_decoder
        .decoder()
        .video()
        .map_err(|e| format!("Failed to create video decoder: {e}"))?;
    Ok((stream_index, time_base_f64, decoder))
}

fn setup_scaler(
    decoder: &ffmpeg::decoder::Video,
    target_width: u32,
    target_height: u32,
) -> Result<Scaler, String> {
    Scaler::get(
        decoder.format(),
        decoder.width(),
        decoder.height(),
        Pixel::RGB24,
        target_width,
        target_height,
        Flags::FAST_BILINEAR,
    )
    .map_err(|e| format!("Failed to create scaler: {e}"))
}

fn encode_jpeg(rgb_data: &[u8], stride: usize, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let row_len = (width * 3) as usize;
    let packed: Vec<u8> = rgb_data
        .chunks(stride)
        .take(height as usize)
        .flat_map(|row| &row[..row_len.min(row.len())])
        .copied()
        .collect();
    let mut buf = Vec::with_capacity(8 * 1024);
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
        encoder
            .encode(&packed, width, height, ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG encode failed: {e}"))?;
    }
    Ok(buf)
}

fn time_points(duration_secs: f64) -> Vec<f64> {
    if duration_secs <= 0.0 {
        return vec![0.0];
    }
    let interval = INTERVAL_SEC.max(0.1);
    let num_frames = (duration_secs / interval).ceil() as usize;
    let num_frames = num_frames.max(1);
    (0..num_frames)
        .map(|i| {
            let t = i as f64 * interval;
            (t * 10.0).round() / 10.0
        })
        .collect()
}

struct WorkerMessage {
    index: usize,
    t: f64,
    rgb_data: Vec<u8>,
    stride: usize,
}

struct EncodedThumb {
    index: usize,
    t: f64,
    jpeg: Vec<u8>,
    b64: String,
}

fn spawn_encoder_worker(
    rx: mpsc::Receiver<WorkerMessage>,
    target_width: u32,
    target_height: u32,
) -> std::thread::JoinHandle<Result<Vec<EncodedThumb>, String>> {
    std::thread::spawn(move || {
        let mut out = Vec::new();
        for msg in rx {
            let jpeg = encode_jpeg(&msg.rgb_data, msg.stride, target_width, target_height)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
            out.push(EncodedThumb {
                index: msg.index,
                t: msg.t,
                jpeg,
                b64,
            });
        }
        Ok(out)
    })
}

fn write_pack_and_index(
    data_dir: &Path,
    target_height: u32,
    encoded: &[EncodedThumb],
) -> Result<(), String> {
    if encoded.is_empty() {
        return Err("Could not extract any thumbnail frames.".to_string());
    }

    let mut pack = String::with_capacity(encoded.len() * 1024);
    let mut frames = Vec::with_capacity(encoded.len());
    for (i, frame) in encoded.iter().enumerate() {
        let line = ThumbPackLine {
            t: frame.t,
            jpeg: &frame.b64,
        };
        let line_json =
            serde_json::to_string(&line).map_err(|e| format!("NDJSON encode failed: {e}"))?;
        pack.push_str(&line_json);
        pack.push('\n');

        let file = thumb_file_name(i);
        if i == 0 {
            fs::write(data_dir.join(&file), &frame.jpeg).map_err(|e| e.to_string())?;
        }
        frames.push(ThumbnailsIndexFrame { t: frame.t, file });
    }

    fs::write(data_dir.join(CLIPPER_THUMBNAILS_PACK_FILE), pack).map_err(|e| e.to_string())?;

    let cover_file = frames[0].file.clone();
    let index = ThumbnailsIndex {
        version: 2,
        interval_sec: INTERVAL_SEC,
        height: target_height,
        format: "jpeg",
        pack_file: CLIPPER_THUMBNAILS_PACK_FILE.to_string(),
        cover_file,
        frames,
    };
    let index_json =
        serde_json::to_string_pretty(&index).map_err(|e| format!("Failed to serialize index: {e}"))?;
    fs::write(data_dir.join(CLIPPER_THUMBNAILS_INDEX_FILE), index_json)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn queue_target(
    idx: usize,
    t: f64,
    rgb_data: Vec<u8>,
    stride: usize,
    senders: &[SyncSender<WorkerMessage>],
) -> Result<(), String> {
    let worker = idx % ENCODER_WORKERS;
    senders[worker]
        .send(WorkerMessage {
            index: idx,
            t,
            rgb_data,
            stride,
        })
        .map_err(|_| "Thumbnail encoder worker disconnected".to_string())?;
    Ok(())
}

fn queue_targets_for_frame(
    frame_timestamp: f64,
    rgb_frame: &ffmpeg::frame::Video,
    targets: &[f64],
    next_target_idx: &mut usize,
    queued: &mut usize,
    last_rgb: &mut Option<(Vec<u8>, usize)>,
    senders: &[SyncSender<WorkerMessage>],
    app: Option<&AppHandle>,
    project_id: &str,
    total_targets: usize,
) -> Result<(), String> {
    while *next_target_idx < targets.len() && frame_timestamp + 0.001 >= targets[*next_target_idx]
    {
        let t = targets[*next_target_idx];
        let rgb_data = rgb_frame.data(0).to_vec();
        let stride = rgb_frame.stride(0);
        *last_rgb = Some((rgb_data.clone(), stride));
        queue_target(*next_target_idx, t, rgb_data, stride, senders)?;
        *next_target_idx += 1;
        *queued += 1;
        emit_thumbnails_progress(app, project_id, *queued, total_targets);
    }
    Ok(())
}

fn drain_decoded_frames(
    decoder: &mut ffmpeg::decoder::Video,
    scaler: &mut Scaler,
    time_base_f64: f64,
    targets: &[f64],
    next_target_idx: &mut usize,
    queued: &mut usize,
    last_rgb: &mut Option<(Vec<u8>, usize)>,
    senders: &[SyncSender<WorkerMessage>],
    app: Option<&AppHandle>,
    project_id: &str,
    total_targets: usize,
) -> Result<(), String> {
    let mut decoded = ffmpeg::frame::Video::empty();
    while decoder.receive_frame(&mut decoded).is_ok() {
        let pts = decoded.pts().unwrap_or(0);
        let frame_timestamp = pts as f64 * time_base_f64;
        let mut rgb_frame = ffmpeg::frame::Video::empty();
        if scaler.run(&decoded, &mut rgb_frame).is_err() {
            continue;
        }
        queue_targets_for_frame(
            frame_timestamp,
            &rgb_frame,
            targets,
            next_target_idx,
            queued,
            last_rgb,
            senders,
            app,
            project_id,
            total_targets,
        )?;
    }
    Ok(())
}

pub(crate) fn extract_studio_thumbnails_blocking(
    data_dir: PathBuf,
    app: Option<AppHandle>,
    project_id: String,
) -> Result<ExtractClipperStudioThumbnailsResult, String> {
    ensure_ffmpeg_init()?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let video_path = data_dir.join(CLIPPER_TRIMMED_SEGMENT_FILE);
    if !video_path.is_file() {
        return Err(format!(
            "Missing {CLIPPER_TRIMMED_SEGMENT_FILE} in project data. Finish clip processing first."
        ));
    }

    clear_existing_studio_thumbs(&data_dir)?;

    let mut ictx = ffmpeg::format::input(&video_path).map_err(|e| format!("Input error: {e}"))?;
    let raw_duration = ictx.duration();
    let duration_secs = if raw_duration > 0 {
        raw_duration as f64 / 1_000_000.0
    } else {
        0.0
    };

    let targets = time_points(duration_secs);
    let total_targets = targets.len().max(1);
    emit_thumbnails_progress(app.as_ref(), &project_id, 0, total_targets);

    let (video_stream_index, time_base_f64, mut decoder) = setup_decoder(&ictx)?;
    let aspect_ratio = decoder.width() as f32 / decoder.height().max(1) as f32;
    let target_height = TARGET_BASE_HEIGHT;
    let target_width = (target_height as f32 * aspect_ratio).round().max(1.0) as u32;
    let mut scaler = setup_scaler(&decoder, target_width, target_height)?;

    let mut senders: Vec<SyncSender<WorkerMessage>> = Vec::with_capacity(ENCODER_WORKERS);
    let mut workers = Vec::with_capacity(ENCODER_WORKERS);
    for _ in 0..ENCODER_WORKERS {
        let (tx, rx) = mpsc::sync_channel::<WorkerMessage>(CHANNEL_CAPACITY_PER_WORKER);
        senders.push(tx);
        workers.push(spawn_encoder_worker(rx, target_width, target_height));
    }

    let mut next_target_idx = 0usize;
    let mut queued = 0usize;
    let mut last_rgb: Option<(Vec<u8>, usize)> = None;

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_stream_index {
            continue;
        }
        if decoder.send_packet(&packet).is_err() {
            continue;
        }
        drain_decoded_frames(
            &mut decoder,
            &mut scaler,
            time_base_f64,
            &targets,
            &mut next_target_idx,
            &mut queued,
            &mut last_rgb,
            &senders,
            app.as_ref(),
            &project_id,
            total_targets,
        )?;
    }

    let _ = decoder.send_eof();
    drain_decoded_frames(
        &mut decoder,
        &mut scaler,
        time_base_f64,
        &targets,
        &mut next_target_idx,
        &mut queued,
        &mut last_rgb,
        &senders,
        app.as_ref(),
        &project_id,
        total_targets,
    )?;

    if let Some((ref rgb_data, stride)) = last_rgb {
        while next_target_idx < targets.len() {
            let t = targets[next_target_idx];
            queue_target(next_target_idx, t, rgb_data.clone(), stride, &senders)?;
            next_target_idx += 1;
            queued += 1;
            emit_thumbnails_progress(app.as_ref(), &project_id, queued, total_targets);
        }
    }

    drop(senders);

    let mut encoded: Vec<EncodedThumb> = Vec::with_capacity(queued);
    for worker in workers {
        let chunk = worker
            .join()
            .map_err(|_| "Thumbnail encoder worker panicked".to_string())??;
        encoded.extend(chunk);
    }
    encoded.sort_by_key(|f| f.index);

    if encoded.is_empty() {
        return Err("Could not extract any thumbnail frames.".to_string());
    }

    write_pack_and_index(&data_dir, target_height, &encoded)?;
    let count = encoded.len();
    emit_thumbnails_progress(app.as_ref(), &project_id, count, total_targets);

    Ok(ExtractClipperStudioThumbnailsResult {
        index_file_name: CLIPPER_THUMBNAILS_INDEX_FILE.to_string(),
        pack_file_name: CLIPPER_THUMBNAILS_PACK_FILE.to_string(),
        interval_sec: INTERVAL_SEC,
        height: target_height,
        count,
    })
}

pub(crate) fn studio_thumbnails_look_fresh(data_dir: &Path, duration_secs: f64) -> bool {
    let index_path = data_dir.join(CLIPPER_THUMBNAILS_INDEX_FILE);
    let pack_path = data_dir.join(CLIPPER_THUMBNAILS_PACK_FILE);
    if !pack_path.is_file() {
        return false;
    }
    let Ok(raw) = fs::read_to_string(&index_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let expected = time_points(duration_secs).len();
    let Some(frames) = value.get("frames").and_then(|f| f.as_array()) else {
        return false;
    };
    if frames.len() != expected {
        return false;
    }
    let height = value
        .get("height")
        .and_then(|h| h.as_u64())
        .unwrap_or(0) as u32;
    if height != TARGET_BASE_HEIGHT {
        return false;
    }
    let cover = value
        .get("coverFile")
        .or_else(|| value.get("cover_file"))
        .and_then(|v| v.as_str())
        .unwrap_or("thumb-0000.jpg");
    data_dir.join(cover).is_file()
}
