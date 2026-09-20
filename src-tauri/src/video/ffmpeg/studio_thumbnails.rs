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
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use super::frames::ensure_ffmpeg_init;
use super::studio_clip::studio_source_key;

const TARGET_BASE_HEIGHT: u32 = 120;
const JPEG_QUALITY: u8 = 70;
const INTERVAL_SEC: f64 = 1.0;
const ENCODER_WORKERS: usize = 4;
const CHANNEL_CAPACITY_PER_WORKER: usize = 40;
const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(50);
const INTERVAL_EPSILON: f64 = 1e-3;

pub(crate) const STUDIO_THUMBNAILS_PROGRESS_EVENT: &str = "studio-thumbnails-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioThumbnailsProgressEvent {
    pub project_id: String,
    pub done: usize,
    pub total: usize,
    pub ratio: f64,
}

struct ProgressEmitter<'a> {
    app: Option<&'a AppHandle>,
    project_id: &'a str,
    total: usize,
    last_sent_at: Option<Instant>,
    last_pct: Option<u32>,
}

impl<'a> ProgressEmitter<'a> {
    fn new(app: Option<&'a AppHandle>, project_id: &'a str, total: usize) -> Self {
        Self {
            app,
            project_id,
            total: total.max(1),
            last_sent_at: None,
            last_pct: None,
        }
    }

    fn emit(&mut self, done: usize) {
        self.emit_inner(done, false);
    }

    fn emit_now(&mut self, done: usize) {
        self.emit_inner(done, true);
    }

    fn emit_inner(&mut self, done: usize, force: bool) {
        let Some(app) = self.app else {
            return;
        };
        let done = done.min(self.total);
        let pct = ((done as f64 / self.total as f64) * 100.0).round() as u32;
        if !force {
            let pct_unchanged = self.last_pct == Some(pct);
            let too_soon = self
                .last_sent_at
                .is_some_and(|at| at.elapsed() < PROGRESS_MIN_INTERVAL);
            if pct_unchanged || too_soon {
                return;
            }
        }
        self.last_pct = Some(pct);
        self.last_sent_at = Some(Instant::now());
        let _ = app.emit(
            STUDIO_THUMBNAILS_PROGRESS_EVENT,
            StudioThumbnailsProgressEvent {
                project_id: self.project_id.to_string(),
                done,
                total: self.total,
                ratio: done as f64 / self.total as f64,
            },
        );
    }
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
    video_file: String,
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
    pub video_file_name: String,
    pub height: u32,
    pub count: usize,
}

struct ThumbnailFiles {
    id: String,
    index: String,
    pack: String,
}

impl ThumbnailFiles {
    fn new(id: String) -> Self {
        Self {
            index: format!("clip-thumbnails-{id}.json"),
            pack: format!("clip-thumbnails-{id}.ndjson"),
            id,
        }
    }
    fn frame(&self, index: usize) -> String {
        format!("thumb-{}-{index:04}.jpg", self.id)
    }
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
    let context_decoder =
        ffmpeg::codec::context::Context::from_parameters(input_stream.parameters())
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

fn time_points_in_range(start_sec: f64, end_sec: f64) -> Vec<f64> {
    let interval = INTERVAL_SEC.max(0.1);
    let start = start_sec.max(0.0);
    let end = end_sec.max(start);
    let first_index = (start / interval).floor().max(0.0) as usize;
    let last_index = (end / interval).floor().max(0.0) as usize;
    let last_index = last_index.max(first_index);
    (first_index..=last_index)
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
    files: &ThumbnailFiles,
    target_height: u32,
    video_file_name: &str,
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

        let file = files.frame(i);
        if i == 0 {
            fs::write(data_dir.join(&file), &frame.jpeg).map_err(|e| e.to_string())?;
        }
        frames.push(ThumbnailsIndexFrame { t: frame.t, file });
    }

    fs::write(data_dir.join(&files.pack), pack).map_err(|e| e.to_string())?;

    let cover_file = frames[0].file.clone();
    let index = ThumbnailsIndex {
        version: 5,
        interval_sec: INTERVAL_SEC,
        video_file: video_file_name.to_string(),
        height: target_height,
        format: "jpeg",
        pack_file: files.pack.clone(),
        cover_file,
        frames,
    };
    let index_json = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize index: {e}"))?;
    fs::write(data_dir.join(&files.index), index_json).map_err(|e| e.to_string())?;

    Ok(())
}

struct ThumbCollector<'a> {
    targets: &'a [f64],
    next_target_idx: usize,
    queued: usize,
    last_rgb: Option<(Vec<u8>, usize)>,
    senders: Vec<SyncSender<WorkerMessage>>,
    progress: ProgressEmitter<'a>,
}

impl<'a> ThumbCollector<'a> {
    fn new(
        targets: &'a [f64],
        senders: Vec<SyncSender<WorkerMessage>>,
        progress: ProgressEmitter<'a>,
    ) -> Self {
        Self {
            targets,
            next_target_idx: 0,
            queued: 0,
            last_rgb: None,
            senders,
            progress,
        }
    }

    fn done(&self) -> bool {
        self.next_target_idx >= self.targets.len()
    }

    fn queue(
        &mut self,
        idx: usize,
        t: f64,
        rgb_data: Vec<u8>,
        stride: usize,
    ) -> Result<(), String> {
        let worker = idx % self.senders.len();
        self.senders[worker]
            .send(WorkerMessage {
                index: idx,
                t,
                rgb_data,
                stride,
            })
            .map_err(|_| "Thumbnail encoder worker disconnected".to_string())?;
        self.next_target_idx += 1;
        self.queued += 1;
        self.progress.emit(self.queued);
        Ok(())
    }

    fn take_frame(
        &mut self,
        frame_timestamp: f64,
        rgb_frame: &ffmpeg::frame::Video,
    ) -> Result<(), String> {
        while !self.done() && frame_timestamp + 0.001 >= self.targets[self.next_target_idx] {
            let t = self.targets[self.next_target_idx];
            let rgb_data = rgb_frame.data(0).to_vec();
            let stride = rgb_frame.stride(0);
            self.last_rgb = Some((rgb_data.clone(), stride));
            let idx = self.next_target_idx;
            self.queue(idx, t, rgb_data, stride)?;
        }
        Ok(())
    }

    fn drain_decoded(
        &mut self,
        decoder: &mut ffmpeg::decoder::Video,
        scaler: &mut Scaler,
        time_base_f64: f64,
    ) -> Result<(), String> {
        let mut decoded = ffmpeg::frame::Video::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            if self.done() {
                continue;
            }
            let pts = decoded.pts().unwrap_or(0);
            let frame_timestamp = pts as f64 * time_base_f64;
            if frame_timestamp + 0.001 < self.targets[self.next_target_idx] {
                continue;
            }
            let mut rgb_frame = ffmpeg::frame::Video::empty();
            if scaler.run(&decoded, &mut rgb_frame).is_err() {
                continue;
            }
            self.take_frame(frame_timestamp, &rgb_frame)?;
        }
        Ok(())
    }

    fn backfill_tail(&mut self) -> Result<(), String> {
        let Some((rgb_data, stride)) = self.last_rgb.clone() else {
            return Ok(());
        };
        while !self.done() {
            let t = self.targets[self.next_target_idx];
            let idx = self.next_target_idx;
            self.queue(idx, t, rgb_data.clone(), stride)?;
        }
        Ok(())
    }
}

fn read_thumbnails_index(data_dir: &Path, files: &ThumbnailFiles) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(data_dir.join(&files.index)).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()
}

fn json_f64(value: &serde_json::Value, camel: &str, snake: &str) -> Option<f64> {
    value
        .get(camel)
        .or_else(|| value.get(snake))
        .and_then(|v| v.as_f64())
}

fn is_newer_or_same(path: &Path, than: &Path) -> bool {
    let modified = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
    match (modified(path), modified(than)) {
        (Some(a), Some(b)) => a >= b,
        _ => false,
    }
}

fn cached_thumbnails_result(
    data_dir: &Path,
    video_file_name: &str,
    cache_path: &Path,
) -> Option<ExtractClipperStudioThumbnailsResult> {
    let id = fs::read_to_string(cache_path).ok()?;
    let id = uuid::Uuid::parse_str(&id).ok()?.simple().to_string();
    let files = ThumbnailFiles::new(id);
    let index_path = data_dir.join(&files.index);
    if !data_dir.join(&files.pack).is_file()
        || !is_newer_or_same(&index_path, &data_dir.join(video_file_name))
    {
        return None;
    }
    let index = read_thumbnails_index(data_dir, &files)?;

    let cached_video = index
        .get("videoFile")
        .or_else(|| index.get("video_file"))
        .and_then(|v| v.as_str())?;
    if cached_video != video_file_name {
        return None;
    }
    let height = index.get("height").and_then(|h| h.as_u64())? as u32;
    if height != TARGET_BASE_HEIGHT {
        return None;
    }
    let interval_sec = json_f64(&index, "intervalSec", "interval_sec")?;
    if (interval_sec - INTERVAL_SEC).abs() > INTERVAL_EPSILON {
        return None;
    }

    let frames = index.get("frames").and_then(|f| f.as_array())?;
    if frames.is_empty() {
        return None;
    }
    let cover = index
        .get("coverFile")
        .or_else(|| index.get("cover_file"))
        .and_then(|v| v.as_str())
        .unwrap_or("thumb-0000.jpg");
    if !data_dir.join(cover).is_file() {
        return None;
    }

    Some(ExtractClipperStudioThumbnailsResult {
        index_file_name: files.index,
        pack_file_name: files.pack,
        interval_sec,
        video_file_name: video_file_name.to_string(),
        height,
        count: frames.len(),
    })
}

pub(crate) fn extract_studio_thumbnails_blocking(
    data_dir: PathBuf,
    video_file_name: String,
    force: bool,
    app: Option<AppHandle>,
    project_id: String,
) -> Result<ExtractClipperStudioThumbnailsResult, String> {
    ensure_ffmpeg_init()?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let video_path = data_dir.join(&video_file_name);
    if !video_path.is_file() {
        return Err(format!(
            "Missing {video_file_name} in project data. Finish clip processing first."
        ));
    }

    let cache_path = data_dir.join(format!(
        ".studio-thumbnails-v5-{}.cache",
        studio_source_key(&video_path)?
    ));

    if !force {
        if let Some(cached) = cached_thumbnails_result(&data_dir, &video_file_name, &cache_path) {
            ProgressEmitter::new(app.as_ref(), &project_id, cached.count).emit_now(cached.count);
            return Ok(cached);
        }
    }
    let files = ThumbnailFiles::new(uuid::Uuid::new_v4().simple().to_string());

    let mut ictx = ffmpeg::format::input(&video_path).map_err(|e| format!("Input error: {e}"))?;
    let raw_duration = ictx.duration();
    let duration_secs = if raw_duration > 0 {
        raw_duration as f64 / 1_000_000.0
    } else {
        0.0
    };

    let targets = time_points_in_range(0.0, duration_secs);
    let total_targets = targets.len().max(1);
    let mut progress = ProgressEmitter::new(app.as_ref(), &project_id, total_targets);

    progress.emit_now(0);

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

    let mut collector = ThumbCollector::new(&targets, senders, progress);

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_stream_index {
            continue;
        }
        if decoder.send_packet(&packet).is_err() {
            continue;
        }
        collector.drain_decoded(&mut decoder, &mut scaler, time_base_f64)?;
        if collector.done() {
            break;
        }
    }

    if !collector.done() {
        let _ = decoder.send_eof();
        collector.drain_decoded(&mut decoder, &mut scaler, time_base_f64)?;
    }
    collector.backfill_tail()?;

    let queued = collector.queued;
    let mut progress = collector.progress;
    drop(collector.senders);

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

    write_pack_and_index(&data_dir, &files, target_height, &video_file_name, &encoded)?;
    let _ = fs::write(&cache_path, &files.id);
    let count = encoded.len();
    progress.emit_now(count);

    Ok(ExtractClipperStudioThumbnailsResult {
        index_file_name: files.index,
        pack_file_name: files.pack,
        interval_sec: INTERVAL_SEC,
        video_file_name,
        height: target_height,
        count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_points_stay_on_the_global_grid() {
        assert_eq!(
            time_points_in_range(12.3, 20.0),
            vec![12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0, 20.0]
        );
        assert_eq!(time_points_in_range(0.0, 3.4), vec![0.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn time_points_never_return_an_empty_set() {
        assert_eq!(time_points_in_range(0.0, 0.0), vec![0.0]);
        assert_eq!(time_points_in_range(9.0, 3.0), vec![9.0]);
    }
}
