use ffmpeg_next as ffmpeg;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_next::{format::Pixel, media::Type};
use image::{codecs::jpeg::JpegEncoder, ExtendedColorType};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::video_processing::histogram::compute_rgb_histogram_raw;
use crate::video_processing::scene_detection::detect_scenes_adaptive;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperFrame {
    pub(crate) timestamp: f64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    /// URL klatki w protokole `grepcut-media` (token katalogowy). Klatki są
    /// zapisywane na dysk zamiast przesyłane base64 przez IPC — dekodowanie
    /// i detekcja twarzy odbywają się w workerach webview przez fetch(url).
    pub(crate) frame_url: String,
    /// Twarde cięcie wykryte między poprzednią a tą klatką twarzy — sygnał dla
    /// sesji śledzenia w workerze detekcji, żeby wymusić pełny pipeline.
    /// Tylko zunifikowana ścieżka (detektor online) ustawia to pole; ścieżka
    /// face-only liczy cięcia dopiero po fakcie i zostawia `false`.
    pub(crate) scene_cut: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperFrameProgress {
    pub(crate) phase: String,
    pub(crate) processed_frames: usize,
    pub(crate) expected_frames: usize,
    pub(crate) percent: usize,
    pub(crate) timestamp_sec: f64,
    pub(crate) frame: Option<ClipperFrame>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExtractionSummary {
    /// Identyfikator joba — frontend przekazuje go do `cleanup_clipper_frames`
    /// po zakończeniu detekcji, żeby usunąć pliki klatek z cache.
    pub(crate) job_id: String,
    pub(crate) frame_count: usize,
    pub(crate) encoded_bytes: usize,
    pub(crate) width: u32,
    pub(crate) height: u32,
    /// Timestamps (relative to `start_time`, same domain as `ClipperFrame.timestamp`)
    /// where a hard cut was detected — the camera-follow track should teleport
    /// to the new target here instead of easing across the cut.
    pub(crate) scene_cut_timestamps: Vec<f64>,
}

/// Reuses the same per-frame RGB histograms already computed for scene-splitting
/// (see `scene_detection::detect_scenes_adaptive`) to find hard cuts among the
/// sparse frames this extractor already decodes for face detection — no extra
/// decode pass. Returns each detected scene's start timestamp except the first,
/// since that one is just the clip's start, not a cut.
pub(crate) fn detect_scene_cut_timestamps(mut samples: Vec<(f64, [u32; 192])>) -> Vec<f64> {
    samples.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let timestamps: Vec<f64> = samples.iter().map(|(t, _)| *t).collect();
    let histograms: Vec<[u32; 192]> = samples.into_iter().map(|(_, h)| h).collect();

    let n = timestamps.len();
    detect_scenes_adaptive(&histograms)
        .into_iter()
        .skip(1)
        .map(|scene| timestamps[scene.start_frame_index.min(n.saturating_sub(1))])
        .collect()
}

/// Streaming form used by the unified decoder: AutoFlip evaluates a shot
/// boundary on every decoded frame, while ML detection remains sparse.
pub(crate) struct AutoFlipShotBoundaryDetector {
    previous: Option<[u32; 64]>,
    motions: std::collections::VecDeque<f64>,
    history_size: usize,
    min_cut_spacing: f64,
    last_cut: f64,
}

impl AutoFlipShotBoundaryDetector {
    pub(crate) fn new() -> Self {
        Self::with_history_size(15, 0.2)
    }

    /// Keeps AutoFlip's roughly 250 ms motion window when histograms are
    /// sampled below source cadence.
    pub(crate) fn for_sample_rate(samples_per_second: f64) -> Self {
        let history_size = (samples_per_second.max(1.0) * 0.25).ceil() as usize;
        // A cut can remain above threshold for two adjacent sampled frames.
        // Add a small cadence-aware hysteresis so that a 10 Hz
        // stream does not report both 200.0 ms-apart observations, while the
        // full-cadence detector retains AutoFlip's original 200 ms spacing.
        let min_cut_spacing = (2.05 / samples_per_second.max(1.0)).max(0.2);
        Self::with_history_size(history_size.max(2), min_cut_spacing)
    }

    fn with_history_size(history_size: usize, min_cut_spacing: f64) -> Self {
        Self {
            previous: None,
            motions: std::collections::VecDeque::new(),
            history_size: history_size.max(2),
            min_cut_spacing,
            last_cut: 0.0,
        }
    }

    pub(crate) fn push(&mut self, timestamp: f64, current: [u32; 64]) -> bool {
        let Some(last) = self.previous.replace(current) else {
            return false;
        };
        let mean_a = last.iter().map(|value| *value as f64).sum::<f64>() / 64.0;
        let mean_b = current.iter().map(|value| *value as f64).sum::<f64>() / 64.0;
        let (numerator, norm_a, norm_b) =
            last.iter()
                .zip(current.iter())
                .fold((0.0, 0.0, 0.0), |(n, a, b), (left, right)| {
                    let da = *left as f64 - mean_a;
                    let db = *right as f64 - mean_b;
                    (n + da * db, a + da * da, b + db * db)
                });
        let correlation = if norm_a == 0.0 || norm_b == 0.0 {
            1.0
        } else {
            numerator / (norm_a.sqrt() * norm_b.sqrt())
        };
        let motion = 1.0 - correlation;
        self.motions.push_front(motion);
        if self.motions.len() < self.history_size {
            return false;
        }
        let current_max = self.motions.iter().copied().fold(0.0_f64, f64::max);
        let shot_measure = if current_max > 0.0 {
            motion / current_max
        } else {
            0.0
        };
        let is_change = (shot_measure > 10.0 && motion > 0.05) || motion > 0.3;
        self.motions.pop_back();
        if is_change && timestamp - self.last_cut >= self.min_cut_spacing {
            self.last_cut = timestamp;
            return true;
        }
        false
    }
}

/// Lossless trim must open on an IDR keyframe; P/B frames at GOP start corrupt playback.
pub(crate) fn should_mux_video_packet(is_key: bool, mux_started: bool) -> bool {
    mux_started || is_key
}

/// Withhold audio until video mux has started on a keyframe (A/V sync at clip head).
pub(crate) fn should_write_audio_packet(video_mux_started: bool) -> bool {
    video_mux_started
}

/// After seek, skip non-keyframes until the decoder receives a fresh IDR.
pub(crate) fn should_decode_video_packet(is_key: bool, seen_keyframe: bool) -> bool {
    seen_keyframe || is_key
}

#[cfg(test)]
mod tests {
    use super::{
        should_decode_video_packet, should_mux_video_packet, should_write_audio_packet,
        AutoFlipShotBoundaryDetector,
    };

    fn histogram(bin: usize) -> [u32; 64] {
        let mut values = [0; 64];
        values[bin] = 10_000;
        values
    }

    #[test]
    fn detects_a_hard_cut_after_the_graph_history_is_warm() {
        let mut detector = AutoFlipShotBoundaryDetector::new();
        assert!(!detector.push(0.0, histogram(0)));
        for frame in 1..15 {
            assert!(!detector.push(frame as f64 / 30.0, histogram(0)));
        }

        assert!(detector.push(0.5, histogram(1)));
    }

    #[test]
    fn enforces_the_minimum_cut_spacing() {
        let mut detector = AutoFlipShotBoundaryDetector::new();
        assert!(!detector.push(0.0, histogram(0)));
        for frame in 1..15 {
            assert!(!detector.push(frame as f64 / 30.0, histogram(0)));
        }

        assert!(detector.push(0.5, histogram(1)));
        assert!(!detector.push(0.6, histogram(0)));
    }

    #[test]
    fn sampled_detector_preserves_the_quarter_second_warmup() {
        let mut detector = AutoFlipShotBoundaryDetector::for_sample_rate(10.0);
        assert!(!detector.push(0.0, histogram(0)));
        assert!(!detector.push(0.1, histogram(0)));
        assert!(!detector.push(0.2, histogram(0)));
        assert!(detector.push(0.3, histogram(1)));
        assert!(!detector.push(0.5, histogram(0)));
        assert!(detector.push(0.6, histogram(1)));
    }

    #[test]
    fn mux_gate_waits_for_first_keyframe() {
        assert!(!should_mux_video_packet(false, false));
        assert!(should_mux_video_packet(true, false));
        assert!(should_mux_video_packet(false, true));
    }

    #[test]
    fn audio_mux_gate_follows_video_keyframe() {
        assert!(!should_write_audio_packet(false));
        assert!(should_write_audio_packet(true));
    }

    #[test]
    fn decode_gate_waits_for_keyframe_after_seek() {
        assert!(!should_decode_video_packet(false, false));
        assert!(should_decode_video_packet(true, false));
        assert!(should_decode_video_packet(false, true));
    }
}

fn encode_jpeg(frame: &ffmpeg::frame::Video, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let row_len = width as usize * 3;
    let mut rgb = Vec::with_capacity(row_len * height as usize);
    for row in 0..height as usize {
        let start = row * frame.stride(0);
        rgb.extend_from_slice(&frame.data(0)[start..start + row_len]);
    }
    let mut jpeg = Vec::with_capacity(rgb.len() / 4);
    JpegEncoder::new_with_quality(&mut jpeg, 82)
        .encode(&rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encode error: {e}"))?;
    Ok(jpeg)
}

/// Zapisuje JPEG klatki do katalogu joba i zwraca (ClipperFrame, rozmiar pliku).
pub(crate) fn write_frame(
    frames_dir: &Path,
    frames_base_url: &str,
    frame_index: usize,
    relative_timestamp: f64,
    rgb: &ffmpeg::frame::Video,
    width: u32,
    height: u32,
) -> Result<(ClipperFrame, usize), String> {
    let jpeg = encode_jpeg(rgb, width, height)?;
    let jpeg_len = jpeg.len();
    let file_name = format!("f{frame_index:05}.jpg");
    std::fs::write(frames_dir.join(&file_name), jpeg)
        .map_err(|e| format!("Frame write error: {e}"))?;
    Ok((
        ClipperFrame {
            timestamp: relative_timestamp,
            width,
            height,
            frame_url: format!("{frames_base_url}/{file_name}"),
            scene_cut: false,
        },
        jpeg_len,
    ))
}

pub(crate) fn extract_clipper_frames_blocking(
    file_path: String,
    start_time: f64,
    end_time: f64,
    interval_sec: f64,
    max_dimension: u32,
    job_id: String,
    frames_dir: PathBuf,
    frames_base_url: String,
    cancelled: Arc<AtomicBool>,
    mut on_progress: impl FnMut(ClipperFrameProgress),
) -> Result<ClipperExtractionSummary, String> {
    if end_time <= start_time || interval_sec <= 0.0 {
        return Ok(ClipperExtractionSummary {
            job_id,
            frame_count: 0,
            encoded_bytes: 0,
            width: 0,
            height: 0,
            scene_cut_timestamps: Vec::new(),
        });
    }
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))?;
    let mut input =
        ffmpeg::format::input(&file_path).map_err(|e| format!("Cannot open video: {e}"))?;
    let stream = input
        .streams()
        .best(Type::Video)
        .ok_or("No video stream found")?;
    let stream_index = stream.index();
    let time_base = stream.time_base();
    let time_base_sec = time_base.numerator() as f64 / time_base.denominator() as f64;
    let context = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|e| format!("Decoder context error: {e}"))?;
    let mut decoder = context
        .decoder()
        .video()
        .map_err(|e| format!("Video decoder error: {e}"))?;
    let source_width = decoder.width();
    let source_height = decoder.height();
    let scale = (max_dimension as f64 / source_width.max(source_height) as f64).min(1.0);
    let width = (((source_width as f64 * scale).round() as u32).max(2)) & !1;
    let height = (((source_height as f64 * scale).round() as u32).max(2)) & !1;
    let mut scaler = Scaler::get(
        decoder.format(),
        source_width,
        source_height,
        Pixel::RGB24,
        width,
        height,
        Flags::BILINEAR,
    )
    .map_err(|e| format!("Scaler error: {e}"))?;
    let seek_target = (start_time * 1_000_000.0).round() as i64;
    input
        .seek(seek_target, ..seek_target)
        .map_err(|e| format!("Seek error: {e}"))?;
    let mut frame_count = 0usize;
    let mut encoded_bytes = 0usize;
    let mut keyframe_times = Vec::new();
    let mut histogram_samples: Vec<(f64, [u32; 192])> = Vec::new();
    let mut decoded = ffmpeg::frame::Video::empty();
    // Phase 1: packet scan + I-frames only. This is intentionally sparse and
    // starts face detection quickly without decoding every inter-frame.
    'packets: for (packet_stream, packet) in input.packets() {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        if packet_stream.index() != stream_index || !packet.is_key() {
            continue;
        }
        decoder
            .send_packet(&packet)
            .map_err(|e| format!("Decode packet error: {e}"))?;
        while decoder.receive_frame(&mut decoded).is_ok() {
            if cancelled.load(Ordering::Acquire) {
                break 'packets;
            }
            let Some(pts) = decoded.pts() else {
                continue;
            };
            let timestamp = pts as f64 * time_base_sec;
            if timestamp >= end_time {
                break 'packets;
            }
            if timestamp < start_time {
                continue;
            }
            let mut rgb = ffmpeg::frame::Video::empty();
            scaler
                .run(&decoded, &mut rgb)
                .map_err(|e| format!("Scale error: {e}"))?;
            let relative_timestamp = (timestamp - start_time).max(0.0);
            histogram_samples.push((
                relative_timestamp,
                compute_rgb_histogram_raw(
                    rgb.data(0),
                    rgb.stride(0),
                    width as usize,
                    height as usize,
                ),
            ));
            let (frame, jpeg_len) = write_frame(
                &frames_dir,
                &frames_base_url,
                frame_count,
                relative_timestamp,
                &rgb,
                width,
                height,
            )?;
            keyframe_times.push(timestamp);
            frame_count += 1;
            encoded_bytes += jpeg_len;
            let percent = (((timestamp - start_time) / (end_time - start_time)) * 100.0)
                .clamp(0.0, 100.0) as usize;
            on_progress(ClipperFrameProgress {
                phase: "keyframes".into(),
                processed_frames: frame_count,
                expected_frames: 0,
                percent,
                timestamp_sec: timestamp,
                frame: Some(frame),
            });
        }
    }

    // Phase 2: fill only gaps not covered by a nearby I-frame. Each seek starts
    // at the preceding keyframe and decodes just far enough to obtain one frame.
    const GAP_INTERVAL_SEC: f64 = 1.5;
    const KEYFRAME_COVERAGE_SEC: f64 = 0.65;
    let mut targets = Vec::new();
    let mut target = start_time;
    while target < end_time {
        if !keyframe_times
            .iter()
            .any(|time| (time - target).abs() <= KEYFRAME_COVERAGE_SEC)
        {
            targets.push(target);
        }
        target += GAP_INTERVAL_SEC;
    }
    for (index, target) in targets.iter().copied().enumerate() {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        let seek_target = (target * 1_000_000.0).round() as i64;
        input
            .seek(seek_target, ..seek_target)
            .map_err(|e| format!("Gap-fill seek error: {e}"))?;
        decoder.flush();
        let mut seen_keyframe = false;
        let mut selected: Option<(f64, ffmpeg::frame::Video)> = None;
        'seek_packets: for (packet_stream, packet) in input.packets() {
            if cancelled.load(Ordering::Acquire) {
                break;
            }
            if packet_stream.index() != stream_index {
                continue;
            }
            if !should_decode_video_packet(packet.is_key(), seen_keyframe) {
                continue;
            }
            seen_keyframe = true;
            if decoder.send_packet(&packet).is_err() {
                continue;
            }
            while decoder.receive_frame(&mut decoded).is_ok() {
                if cancelled.load(Ordering::Acquire) {
                    break 'seek_packets;
                }
                let timestamp = decoded.pts().unwrap_or(0) as f64 * time_base_sec;
                if timestamp + 0.02 < target {
                    continue;
                }
                selected = Some((timestamp, decoded.clone()));
                break 'seek_packets;
            }
        }
        if let Some((timestamp, selected_frame)) = selected {
            let mut rgb = ffmpeg::frame::Video::empty();
            scaler
                .run(&selected_frame, &mut rgb)
                .map_err(|e| format!("Gap-fill scale error: {e}"))?;
            let relative_timestamp = (timestamp - start_time).max(0.0);
            histogram_samples.push((
                relative_timestamp,
                compute_rgb_histogram_raw(
                    rgb.data(0),
                    rgb.stride(0),
                    width as usize,
                    height as usize,
                ),
            ));
            let (frame, jpeg_len) = write_frame(
                &frames_dir,
                &frames_base_url,
                frame_count,
                relative_timestamp,
                &rgb,
                width,
                height,
            )?;
            frame_count += 1;
            encoded_bytes += jpeg_len;
            let percent = (((index + 1) as f64 / targets.len().max(1) as f64) * 100.0) as usize;
            on_progress(ClipperFrameProgress {
                phase: "gap-fill".into(),
                processed_frames: index + 1,
                expected_frames: targets.len(),
                percent,
                timestamp_sec: timestamp,
                frame: Some(frame),
            });
        }
    }
    if cancelled.load(Ordering::Acquire) {
        return Err("Native extraction cancelled".into());
    }
    let scene_cut_timestamps = detect_scene_cut_timestamps(histogram_samples);
    on_progress(ClipperFrameProgress {
        phase: "complete".into(),
        processed_frames: frame_count,
        expected_frames: frame_count,
        percent: 100,
        timestamp_sec: end_time,
        frame: None,
    });
    Ok(ClipperExtractionSummary {
        job_id,
        frame_count,
        encoded_bytes,
        width,
        height,
        scene_cut_timestamps,
    })
}

pub(crate) struct ExtractedVideoFrame {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub timestamp_sec: f64,
}

pub(crate) fn extract_frame_rgb_at_timestamp(
    video_path: &Path,
    timestamp_sec: f64,
) -> Result<ExtractedVideoFrame, String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))?;
    let mut input = ffmpeg::format::input(video_path).map_err(|e| format!("Cannot open video: {e}"))?;
    let stream = input
        .streams()
        .best(Type::Video)
        .ok_or("No video stream found")?;
    let stream_index = stream.index();
    let time_base_sec = stream.time_base().numerator() as f64 / stream.time_base().denominator() as f64;
    let context = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|e| format!("Decoder context error: {e}"))?;
    let mut decoder = context
        .decoder()
        .video()
        .map_err(|e| format!("Video decoder error: {e}"))?;
    let width = decoder.width();
    let height = decoder.height();
    let mut scaler = Scaler::get(
        decoder.format(),
        width,
        height,
        Pixel::RGB24,
        width,
        height,
        Flags::BILINEAR,
    )
    .map_err(|e| format!("Scaler error: {e}"))?;
    let seek_target = (timestamp_sec * 1_000_000.0).round() as i64;
    input
        .seek(seek_target, ..seek_target)
        .map_err(|e| format!("Seek error: {e}"))?;
    decoder.flush();
    let mut decoded = ffmpeg::frame::Video::empty();
    let mut seen_keyframe = false;
    let mut selected: Option<(f64, ffmpeg::frame::Video)> = None;
    'seek_packets: for (packet_stream, packet) in input.packets() {
        if packet_stream.index() != stream_index {
            continue;
        }
        if !should_decode_video_packet(packet.is_key(), seen_keyframe) {
            continue;
        }
        seen_keyframe = true;
        if decoder.send_packet(&packet).is_err() {
            continue;
        }
        while decoder.receive_frame(&mut decoded).is_ok() {
            let pts = decoded.pts().unwrap_or(0) as f64 * time_base_sec;
            if pts + 0.02 < timestamp_sec {
                continue;
            }
            selected = Some((pts, decoded.clone()));
            break 'seek_packets;
        }
    }
    let (_, selected_frame) = selected.ok_or_else(|| format!("No frame found near {timestamp_sec:.3}s"))?;
    let mut rgb = ffmpeg::frame::Video::empty();
    scaler
        .run(&selected_frame, &mut rgb)
        .map_err(|e| format!("Scale error: {e}"))?;
    let row_len = width as usize * 3;
    let mut pixels = Vec::with_capacity(row_len * height as usize);
    for row in 0..height as usize {
        let start = row * rgb.stride(0);
        pixels.extend_from_slice(&rgb.data(0)[start..start + row_len]);
    }
    Ok(ExtractedVideoFrame {
        rgb: pixels,
        width,
        height,
        timestamp_sec: selected_frame.pts().unwrap_or(0) as f64 * time_base_sec,
    })
}

pub(crate) fn snap_to_keyframe_blocking(file_path: String, start_time: f64) -> Result<f64, String> {
    if start_time <= 0.0 {
        return Ok(0.0);
    }
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))?;
    let mut input =
        ffmpeg::format::input(&file_path).map_err(|e| format!("Cannot open video: {e}"))?;
    let stream = input
        .streams()
        .best(Type::Video)
        .ok_or("No video stream found")?;
    let index = stream.index();
    let tb = stream.time_base();
    let tb_sec = tb.numerator() as f64 / tb.denominator() as f64;
    let target = (start_time * 1_000_000.0).round() as i64;
    input
        .seek(target, ..target)
        .map_err(|e| format!("Seek error: {e}"))?;
    let mut best = 0.0;
    for (packet_stream, packet) in input.packets() {
        if packet_stream.index() != index || !packet.is_key() {
            continue;
        }
        let timestamp = packet.pts().or_else(|| packet.dts()).unwrap_or(0) as f64 * tb_sec;
        if timestamp > start_time {
            break;
        }
        best = timestamp.max(0.0);
    }
    Ok(best)
}

pub(crate) fn extract_clipper_segment_to_path_blocking(
    file_path: String,
    start_time: f64,
    end_time: f64,
    output_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Output dir error: {e}"))?;
    }
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))?;
    let mut input =
        ffmpeg::format::input(&file_path).map_err(|e| format!("Cannot open video: {e}"))?;
    let mut output =
        ffmpeg::format::output(output_path).map_err(|e| format!("Output error: {e}"))?;
    let mut stream_map = vec![None; input.streams().len()];
    for input_stream in input.streams() {
        if input_stream.parameters().medium() != Type::Video
            && input_stream.parameters().medium() != Type::Audio
        {
            continue;
        }
        let mut output_stream = output
            .add_stream(ffmpeg::encoder::find(ffmpeg::codec::Id::None))
            .map_err(|e| format!("Output stream error: {e}"))?;
        output_stream.set_parameters(input_stream.parameters());
        stream_map[input_stream.index()] = Some(output_stream.index());
    }
    let mut header_opts = ffmpeg::Dictionary::new();
    header_opts.set("movflags", "faststart");
    output
        .write_header_with(header_opts)
        .map_err(|e| format!("Header error: {e}"))?;
    let target = (start_time * 1_000_000.0).round() as i64;
    input
        .seek(target, ..target)
        .map_err(|e| format!("Seek error: {e}"))?;
    let mut video_mux_started = false;
    for (input_stream, mut packet) in input.packets() {
        let Some(output_index) = stream_map[input_stream.index()] else {
            continue;
        };
        let medium = input_stream.parameters().medium();
        let is_video = medium == Type::Video;
        let is_audio = medium == Type::Audio;
        let input_tb = input_stream.time_base();
        let timestamp = packet.pts().or_else(|| packet.dts()).unwrap_or(0) as f64
            * input_tb.numerator() as f64
            / input_tb.denominator() as f64;
        if timestamp < start_time {
            continue;
        }
        if timestamp > end_time {
            if is_video {
                break;
            }
            continue;
        }
        if is_video && !should_mux_video_packet(packet.is_key(), video_mux_started) {
            continue;
        }
        if is_audio && !should_write_audio_packet(video_mux_started) {
            continue;
        }
        if is_video {
            video_mux_started = true;
        }
        let output_tb = output
            .stream(output_index)
            .ok_or("Missing output stream")?
            .time_base();
        let start_ts = (start_time / (input_tb.numerator() as f64 / input_tb.denominator() as f64))
            .round() as i64;
        packet.set_pts(packet.pts().map(|pts| pts - start_ts));
        packet.set_dts(packet.dts().map(|dts| dts - start_ts));
        packet.rescale_ts(input_tb, output_tb);
        packet.set_position(-1);
        packet.set_stream(output_index);
        packet
            .write_interleaved(&mut output)
            .map_err(|e| format!("Mux error: {e}"))?;
    }
    output
        .write_trailer()
        .map_err(|e| format!("Trailer error: {e}"))?;
    Ok(())
}

pub(crate) fn extract_clipper_segment_blocking(
    file_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<Vec<u8>, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let output_path = std::env::temp_dir().join(format!("grepcut-clipper-{nonce}.mp4"));
    extract_clipper_segment_to_path_blocking(file_path, start_time, end_time, &output_path)?;
    let bytes = std::fs::read(&output_path).map_err(|e| format!("Read segment error: {e}"))?;
    let _ = std::fs::remove_file(output_path);
    Ok(bytes)
}
