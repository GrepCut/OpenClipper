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

/// Streaming form used by the unified decoder: AutoFlip evaluates a shot
/// boundary on every decoded frame, while ML detection remains sparse.
pub(crate) struct AutoFlipShotBoundaryDetector {
    previous: Option<[u32; 64]>,
    previous_rgb: Option<Vec<u8>>,
    motions: std::collections::VecDeque<f64>,
    history_size: usize,
    min_cut_spacing: f64,
    last_cut: f64,
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
        Self::with_history_size(history_size.max(2), min_cut_spacing)
    }

    fn with_history_size(history_size: usize, min_cut_spacing: f64) -> Self {
        Self {
            previous: None,
            previous_rgb: None,
            motions: std::collections::VecDeque::new(),
            history_size: history_size.max(2),
            min_cut_spacing,
            last_cut: f64::NEG_INFINITY,
        }
    }

    /// Histogram correlation (AutoFlip) OR mean absolute frame difference.
    /// `rgb` is packed RGB24 matching the histogram scale size.
    pub(crate) fn push(&mut self, timestamp: f64, current: [u32; 64], rgb: Vec<u8>) -> bool {
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
        let is_change = hist_change || diff_change;
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
