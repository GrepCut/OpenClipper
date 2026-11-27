use ffmpeg_next as ffmpeg;
use ffmpeg_next::media::Type;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn ensure_ffmpeg_init() -> Result<(), String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))
}

/// Mean |Δ|/255 on packed RGB that counts as a hard cut when OR-fused with
/// AutoFlip histogram correlation. Tuned above typical within-shot pans;
/// `min_cut_spacing` still suppresses flash double-fires.
const FRAME_DIFF_CUT_THRESHOLD: f64 = 0.18;

/// Adaptive cut rule, OR-fused with the AutoFlip rules above. The absolute
/// thresholds above miss cuts between similar-looking shots (a multi-camera
/// talk show on one dark set). This rule compares each frame's change with the
/// video's own recent motion, so it adapts to calm and to busy footage alike:
///
/// 1. the change is a real picture change (`ADAPTIVE_MIN_SCORE`),
/// 2. it is a sudden jump, `ADAPTIVE_RATIO` times the mean change of the last
///    `ADAPTIVE_WINDOW_SEC` (continuous motion and pans raise that mean and
///    silence the rule),
/// 3. it covers much of the frame (`ADAPTIVE_MIN_SPREAD` of the blocks), so a
///    single video-call tile glitching or a caption popping in is not a cut.
///
/// Block means are compared after removing the frame-wide colour shift, so a
/// flash, an exposure change or a fade step is not mistaken for a cut.
/// Validated across talk shows, video calls, music videos (live action and
/// animated), trailers, sport, nature and animated film.
const ADAPTIVE_BLOCK: usize = 8;
const ADAPTIVE_WINDOW_SEC: f64 = 0.5;
const ADAPTIVE_MIN_SCORE: f64 = 0.04;
const ADAPTIVE_RATIO: f64 = 4.0;
/// Keeps the ratio meaningful on a perfectly still picture.
const ADAPTIVE_BASELINE_FLOOR: f64 = 0.004;
/// A block "changed" when its colour moves by more than this share of 255.
const ADAPTIVE_BLOCK_CHANGE: f64 = 0.05;
const ADAPTIVE_MIN_SPREAD: f64 = 0.3;
const ADAPTIVE_MIN_SPACING_SEC: f64 = 0.4;

struct AdaptiveCutRule {
    width: usize,
    height: usize,
    previous: Option<Vec<f32>>,
    window: std::collections::VecDeque<f64>,
    window_len: usize,
    last_cut: f64,
}

impl AdaptiveCutRule {
    fn new(width: usize, height: usize, samples_per_second: f64) -> Self {
        Self {
            width,
            height,
            previous: None,
            window: std::collections::VecDeque::new(),
            window_len: ((samples_per_second.max(1.0) * ADAPTIVE_WINDOW_SEC).round() as usize).max(3),
            last_cut: f64::NEG_INFINITY,
        }
    }

    fn blocks(&self, rgb: &[u8]) -> Option<Vec<f32>> {
        let (columns, rows) = (self.width / ADAPTIVE_BLOCK, self.height / ADAPTIVE_BLOCK);
        if columns == 0 || rows == 0 || rgb.len() < self.width * self.height * 3 {
            return None;
        }
        let mut blocks = vec![0.0f32; columns * rows * 3];
        for y in 0..rows * ADAPTIVE_BLOCK {
            let block_row = y / ADAPTIVE_BLOCK;
            for x in 0..columns * ADAPTIVE_BLOCK {
                let offset = (y * self.width + x) * 3;
                let block = (block_row * columns + x / ADAPTIVE_BLOCK) * 3;
                for channel in 0..3 {
                    blocks[block + channel] += rgb[offset + channel] as f32;
                }
            }
        }
        let area = (ADAPTIVE_BLOCK * ADAPTIVE_BLOCK) as f32;
        blocks.iter_mut().for_each(|value| *value /= area);
        Some(blocks)
    }

    fn push(&mut self, timestamp: f64, rgb: &[u8]) -> bool {
        let Some(blocks) = self.blocks(rgb) else {
            return false;
        };
        let Some(previous) = self.previous.replace(blocks) else {
            return false;
        };
        let current = self.previous.as_ref().unwrap();
        let count = current.len() / 3;
        let mut shift = [0.0f64; 3];
        for (index, (now, before)) in current.iter().zip(&previous).enumerate() {
            shift[index % 3] += (*now - *before) as f64;
        }
        shift.iter_mut().for_each(|value| *value /= count as f64);
        let mut total = 0.0;
        let mut changed = 0usize;
        for block in 0..count {
            let diff = (0..3)
                .map(|channel| {
                    let index = block * 3 + channel;
                    ((current[index] - previous[index]) as f64 - shift[channel]).abs()
                })
                .sum::<f64>()
                / (3.0 * 255.0);
            total += diff;
            if diff > ADAPTIVE_BLOCK_CHANGE {
                changed += 1;
            }
        }
        let score = total / count as f64;
        let spread = changed as f64 / count as f64;
        let baseline = if self.window.is_empty() {
            0.0
        } else {
            self.window.iter().sum::<f64>() / self.window.len() as f64
        };
        let cut = self.window.len() >= 3
            && score >= ADAPTIVE_MIN_SCORE
            && score >= ADAPTIVE_RATIO * baseline.max(ADAPTIVE_BASELINE_FLOOR)
            && spread >= ADAPTIVE_MIN_SPREAD
            && timestamp - self.last_cut >= ADAPTIVE_MIN_SPACING_SEC;
        if cut {
            self.last_cut = timestamp;
        }
        self.window.push_back(score);
        if self.window.len() > self.window_len {
            self.window.pop_front();
        }
        cut
    }
}

/// Streaming form used by the unified decoder: AutoFlip evaluates a shot
/// boundary on every decoded frame, while ML detection remains sparse.
pub(crate) struct AutoFlipShotBoundaryDetector {
    previous: Option<[u32; 64]>,
    previous_rgb: Option<Vec<u8>>,
    motions: std::collections::VecDeque<f64>,
    history_size: usize,
    min_cut_spacing: f64,
    last_cut: f64,
    samples_per_second: f64,
    adaptive: Option<AdaptiveCutRule>,
}

impl AutoFlipShotBoundaryDetector {
    /// Keeps AutoFlip's roughly 250 ms motion window when histograms are
    /// sampled below source cadence.
    pub(crate) fn for_sample_rate(samples_per_second: f64) -> Self {
        let history_size = (samples_per_second.max(1.0) * 0.25).ceil() as usize;
        // A cut can remain above threshold for two adjacent sampled frames.
        // Add a small cadence-aware hysteresis so that a 10 Hz
        // stream does not report both 200.0 ms-apart observations, while the
        // full-cadence detector retains AutoFlip's original 200 ms spacing.
        let min_cut_spacing = (2.05 / samples_per_second.max(1.0)).max(0.2);
        let mut detector = Self::with_history_size(history_size.max(2), min_cut_spacing);
        detector.samples_per_second = samples_per_second.max(1.0);
        detector
    }

    /// Enables the adaptive rule for packed RGB frames of this size (the
    /// histogram thumbnail). Without it only the AutoFlip rules run.
    pub(crate) fn with_frame_size(mut self, width: usize, height: usize) -> Self {
        self.adaptive = Some(AdaptiveCutRule::new(width, height, self.samples_per_second));
        self
    }

    fn with_history_size(history_size: usize, min_cut_spacing: f64) -> Self {
        Self {
            previous: None,
            previous_rgb: None,
            motions: std::collections::VecDeque::new(),
            history_size: history_size.max(2),
            min_cut_spacing,
            last_cut: f64::NEG_INFINITY,
            samples_per_second: 30.0,
            adaptive: None,
        }
    }

    /// Histogram correlation (AutoFlip) OR mean absolute frame difference.
    /// `rgb` is packed RGB24 matching the histogram scale size.
    pub(crate) fn push(&mut self, timestamp: f64, current: [u32; 64], rgb: Vec<u8>) -> bool {
        let adaptive_change = self
            .adaptive
            .as_mut()
            .is_some_and(|rule| rule.push(timestamp, &rgb));
        let mean_abs_diff = match self.previous_rgb.as_deref() {
            Some(prev) => mean_abs_diff_norm(prev, &rgb),
            None => 0.0,
        };
        self.previous_rgb = Some(rgb);

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
        let hist_ready = self.motions.len() >= self.history_size;
        let hist_change = if hist_ready {
            let current_max = self.motions.iter().copied().fold(0.0_f64, f64::max);
            let shot_measure = if current_max > 0.0 {
                motion / current_max
            } else {
                0.0
            };
            self.motions.pop_back();
            (shot_measure > 10.0 && motion > 0.05) || motion > 0.3
        } else {
            false
        };
        let diff_change = mean_abs_diff >= FRAME_DIFF_CUT_THRESHOLD;
        let is_change = hist_change || diff_change || adaptive_change;
        if is_change && timestamp - self.last_cut >= self.min_cut_spacing {
            self.last_cut = timestamp;
            return true;
        }
        false
    }
}

fn mean_abs_diff_norm(a: &[u8], b: &[u8]) -> f64 {
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let sum: u64 = a
        .iter()
        .zip(b.iter())
        .map(|(left, right)| (*left as i16 - *right as i16).unsigned_abs() as u64)
        .sum();
    (sum as f64 / a.len() as f64) / 255.0
}

#[cfg(test)]
mod shot_boundary_tests {
    use super::{mean_abs_diff_norm, AutoFlipShotBoundaryDetector, FRAME_DIFF_CUT_THRESHOLD};

    fn solid_hist(r_bin: usize, g_bin: usize) -> [u32; 64] {
        let mut hist = [0u32; 64];
        hist[r_bin.min(7) * 8 + g_bin.min(7)] = 10_000;
        hist
    }

    fn solid_rgb(width: usize, height: usize, r: u8, g: u8, b: u8) -> Vec<u8> {
        let mut out = vec![0u8; width * height * 3];
        for pixel in out.chunks_exact_mut(3) {
            pixel[0] = r;
            pixel[1] = g;
            pixel[2] = b;
        }
        out
    }

    #[test]
    fn identical_frames_do_not_fire() {
        let mut detector = AutoFlipShotBoundaryDetector::for_sample_rate(30.0);
        let hist = solid_hist(2, 2);
        let rgb = solid_rgb(8, 8, 40, 40, 40);
        assert!(!detector.push(0.0, hist, rgb.clone()));
        for index in 1..20 {
            assert!(
                !detector.push(index as f64 / 30.0, hist, rgb.clone()),
                "false cut at sample {index}"
            );
        }
    }

    #[test]
    fn hard_hist_change_fires_once() {
        let mut detector = AutoFlipShotBoundaryDetector::for_sample_rate(30.0);
        let dark = solid_hist(0, 0);
        let bright = solid_hist(7, 7);
        let dark_rgb = solid_rgb(8, 8, 0, 0, 0);
        let bright_rgb = solid_rgb(8, 8, 255, 255, 255);
        assert!(!detector.push(0.0, dark, dark_rgb.clone()));
        // Warm the motion window with near-identical frames.
        for index in 1..10 {
            assert!(!detector.push(index as f64 / 30.0, dark, dark_rgb.clone()));
        }
        assert!(detector.push(10.0 / 30.0, bright, bright_rgb));
        // Spacing hysteresis: immediate second fire suppressed.
        assert!(!detector.push(11.0 / 30.0, dark, dark_rgb));
    }

    #[test]
    fn frame_diff_threshold_matches_constant() {
        let a = solid_rgb(4, 4, 0, 0, 0);
        let b = solid_rgb(4, 4, 40, 40, 40);
        let diff = mean_abs_diff_norm(&a, &b);
        assert!((diff - 40.0 / 255.0).abs() < 1e-9);
        assert!(diff < FRAME_DIFF_CUT_THRESHOLD);
        let c = solid_rgb(4, 4, 60, 60, 60);
        assert!(mean_abs_diff_norm(&a, &c) > FRAME_DIFF_CUT_THRESHOLD);
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

fn seconds_to_stream_ticks(seconds: f64, time_base: ffmpeg::Rational) -> i64 {
    (seconds * time_base.denominator() as f64 / time_base.numerator() as f64).round() as i64
}

#[cfg(test)]
mod studio_boundary_tests {
    use super::*;

    #[test]
    fn snapped_5994_fps_keyframes_keep_their_exact_pts() {
        let tb = ffmpeg::Rational(1, 90_000);
        for pts in [150_150_i64, 15_315_300] {
            let snapped = pts as f64 * (1.0 / 90_000.0);
            assert!(pts as f64 / 90_000.0 < snapped);
            assert_eq!(seconds_to_stream_ticks(snapped, tb), pts);
            assert!(pts - 1 < seconds_to_stream_ticks(snapped, tb));
        }
    }
}

pub(crate) fn snap_to_keyframe_blocking(file_path: String, start_time: f64) -> Result<f64, String> {
    if start_time <= 0.0 {
        return Ok(0.0);
    }
    ensure_ffmpeg_init()?;
    let mut input =
        ffmpeg::format::input(&file_path).map_err(|e| format!("Cannot open video: {e}"))?;
    let stream = input
        .streams()
        .best(Type::Video)
        .ok_or("No video stream found")?;
    let index = stream.index();
    let tb = stream.time_base();
    let tb_sec = tb.numerator() as f64 / tb.denominator() as f64;
    let target_pts = seconds_to_stream_ticks(start_time, tb);
    let target = (start_time * 1_000_000.0).round() as i64;
    input
        .seek(target, ..target)
        .map_err(|e| format!("Seek error: {e}"))?;
    let mut best = 0.0;
    for (packet_stream, packet) in input.packets() {
        if packet_stream.index() != index || !packet.is_key() {
            continue;
        }
        let pts = packet.pts().or_else(|| packet.dts()).unwrap_or(0);
        if pts > target_pts {
            break;
        }
        best = (pts as f64 * tb_sec).max(0.0);
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
    ensure_ffmpeg_init()?;
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
        let timestamp = packet.pts().or_else(|| packet.dts()).unwrap_or(0);
        let start_ts = seconds_to_stream_ticks(start_time, input_tb);
        let end_ts = seconds_to_stream_ticks(end_time, input_tb);
        if timestamp < start_ts {
            continue;
        }
        if timestamp > end_ts {
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
