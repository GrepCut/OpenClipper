use ffmpeg_next as ffmpeg;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_next::{format::Pixel, media::Type};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

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
        let mut detector = AutoFlipShotBoundaryDetector::for_sample_rate(30.0);
        assert!(!detector.push(0.0, histogram(0)));
        for frame in 1..15 {
            assert!(!detector.push(frame as f64 / 30.0, histogram(0)));
        }

        assert!(detector.push(0.5, histogram(1)));
    }

    #[test]
    fn enforces_the_minimum_cut_spacing() {
        let mut detector = AutoFlipShotBoundaryDetector::for_sample_rate(30.0);
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

pub(crate) struct ExtractedVideoFrame {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn probe_video_duration_sec(input: &ffmpeg::format::context::Input) -> Option<f64> {
    if input.duration() > 0 {
        return Some(input.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64);
    }
    let stream = input.streams().best(Type::Video)?;
    if stream.duration() <= 0 {
        return None;
    }
    let time_base = stream.time_base();
    Some(
        stream.duration() as f64 * time_base.numerator() as f64
            / time_base.denominator() as f64,
    )
}

pub(crate) fn extract_frame_rgb_at_timestamp(
    video_path: &Path,
    timestamp_sec: f64,
) -> Result<ExtractedVideoFrame, String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))?;
    let mut input = ffmpeg::format::input(video_path).map_err(|e| format!("Cannot open video: {e}"))?;
    let timestamp_sec = match probe_video_duration_sec(&input) {
        Some(duration) if duration > 0.05 => timestamp_sec.min(duration - 0.05),
        _ => timestamp_sec,
    };
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
    let mut last_below: Option<(f64, ffmpeg::frame::Video)> = None;
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
                last_below = Some((pts, decoded.clone()));
                continue;
            }
            selected = Some((pts, decoded.clone()));
            break 'seek_packets;
        }
    }
    if selected.is_none() {
        // The final frames of a stream can still sit in the decoder's reorder
        // buffer when the packet loop hits EOF; drain them so a timestamp near
        // the clip end resolves instead of erroring.
        let _ = decoder.send_eof();
        while decoder.receive_frame(&mut decoded).is_ok() {
            let pts = decoded.pts().unwrap_or(0) as f64 * time_base_sec;
            if pts + 0.02 < timestamp_sec {
                last_below = Some((pts, decoded.clone()));
                continue;
            }
            selected = Some((pts, decoded.clone()));
            break;
        }
    }
    let (_, selected_frame) = selected
        .or(last_below)
        .ok_or_else(|| format!("No frame found near {timestamp_sec:.3}s"))?;
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
