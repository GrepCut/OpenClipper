use ffmpeg_next as ffmpeg;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_next::{format::Pixel, media::Type};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::video_processing::clipper_border::detect_border_features;
use crate::video_processing::clipper_frames::{
    self, should_decode_video_packet, AutoFlipShotBoundaryDetector, ClipperFrame,
    ClipperFrameProgress,
};
use crate::video_processing::clipper_subjects::{self, SubjectFrame, DETECTION_FPS};
use crate::video_processing::histogram::compute_autoflip_histogram_raw;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperMediaProgress {
    phase: String,
    processed_frames: usize,
    expected_frames: usize,
    percent: usize,
    /// Relative to `start_time`, same domain for both frame kinds and for
    /// `ClipperMediaExtractionSummary.scene_cut_timestamps`.
    timestamp_sec: f64,
    /// Smoothed estimate of remaining decode time, `None` until enough
    /// samples have accumulated to produce a stable rate.
    eta_seconds: Option<f64>,
    face_frame: Option<ClipperFrame>,
    subject_frame: Option<SubjectFrame>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperMediaFaceSummary {
    frame_count: usize,
    encoded_bytes: usize,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperMediaSubjectSummary {
    frame_count: usize,
    encoded_bytes: usize,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperMediaExtractionSummary {
    pub(crate) job_id: String,
    face: ClipperMediaFaceSummary,
    /// `None` when `include_motion` was false — no dense decode/motion pass ran.
    subject: Option<ClipperMediaSubjectSummary>,
    scene_cut_timestamps: Vec<f64>,
    frame_timestamps: Vec<f64>,
    source_frame_rate: f64,
    has_solid_color_background: bool,
    solid_background_color: Option<RgbColor>,
    /// Background evidence at the same 5 FPS cadence as AutoFlip keyframes.
    /// The TypeScript cropper aggregates this per shot, not across the video.
    static_feature_samples: Vec<StaticFeatureSample>,
    content_rect: ContentRect,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct RgbColor {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct StaticFeatureSample {
    time: f64,
    has_solid_color_background: bool,
    solid_background_color: Option<RgbColor>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl ContentRect {
    const FULL_FRAME: Self = Self {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    };
}

/// Converts per-frame border observations into a stable content area. A crop
/// must never change merely because one compressed frame has a dark edge, so
/// a border is accepted only when it is present for 90% of decoded frames.
fn stable_content_rect(observations: &[(u32, u32)], frame_height: u32) -> ContentRect {
    if observations.is_empty() || frame_height == 0 {
        return ContentRect::FULL_FRAME;
    }
    let stable = |index: usize| {
        let present = observations
            .iter()
            .filter(|value| if index == 0 { value.0 > 0 } else { value.1 > 0 })
            .count();
        if present * 10 < observations.len() * 9 {
            return 0;
        }
        let mut values: Vec<u32> = observations
            .iter()
            .map(|value| if index == 0 { value.0 } else { value.1 })
            .collect();
        values.sort_unstable();
        values[values.len() / 2]
    };
    let top = stable(0).min(frame_height.saturating_sub(1));
    let bottom = stable(1).min(frame_height.saturating_sub(top + 1));
    ContentRect {
        x: 0.0,
        y: top as f64 / frame_height as f64,
        width: 1.0,
        height: (frame_height - top - bottom) as f64 / frame_height as f64,
    }
}

/// Tracks wall-clock decode rate (relative-media-seconds progressed per
/// wall-clock second) with a simple EMA so `eta_seconds` doesn't jitter on
/// individual slow frames (B-frame-heavy GOPs, transient I/O stalls). Pure
/// arithmetic on values already computed in the decode loop — no I/O, no
/// extra thread, so it cannot introduce blocking.
struct EtaTracker {
    started: Instant,
    smoothed_rate: f64,
}

impl EtaTracker {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            smoothed_rate: 0.0,
        }
    }

    fn eta_seconds(&mut self, relative_timestamp: f64, total_duration: f64) -> Option<f64> {
        let elapsed = self.started.elapsed().as_secs_f64();
        if elapsed <= 0.0 || relative_timestamp <= 0.0 {
            return None;
        }
        let instantaneous_rate = relative_timestamp / elapsed;
        self.smoothed_rate = if self.smoothed_rate <= 0.0 {
            instantaneous_rate
        } else {
            self.smoothed_rate * 0.8 + instantaneous_rate * 0.2
        };
        let remaining = (total_duration - relative_timestamp).max(0.0);
        Some(remaining / self.smoothed_rate.max(0.001))
    }
}

/// Cheap path used when subject/motion tracking is skipped (`include_motion
/// == false`): delegates to the existing sparse I-frame + gap-fill face
/// extractor unchanged, just translated into the unified progress/summary
/// shape so callers don't need to special-case it.
fn extract_face_only(
    file_path: String,
    start_time: f64,
    end_time: f64,
    interval_sec: f64,
    face_max_dimension: u32,
    job_id: String,
    frames_dir: PathBuf,
    frames_base_url: String,
    cancelled: Arc<AtomicBool>,
    mut on_progress: impl FnMut(ClipperMediaProgress),
) -> Result<ClipperMediaExtractionSummary, String> {
    let mut eta_tracker = EtaTracker::new();
    let summary = clipper_frames::extract_clipper_frames_blocking(
        file_path,
        start_time,
        end_time,
        interval_sec,
        face_max_dimension,
        job_id.clone(),
        frames_dir,
        frames_base_url,
        cancelled,
        |progress: ClipperFrameProgress| {
            let relative = (progress.timestamp_sec - start_time).max(0.0);
            let eta = if progress.phase == "complete" {
                Some(0.0)
            } else {
                eta_tracker.eta_seconds(relative, end_time - start_time)
            };
            on_progress(ClipperMediaProgress {
                phase: progress.phase,
                processed_frames: progress.processed_frames,
                expected_frames: progress.expected_frames,
                percent: progress.percent,
                timestamp_sec: relative,
                eta_seconds: eta,
                face_frame: progress.frame,
                subject_frame: None,
            });
        },
    )?;
    Ok(ClipperMediaExtractionSummary {
        job_id,
        face: ClipperMediaFaceSummary {
            frame_count: summary.frame_count,
            encoded_bytes: summary.encoded_bytes,
            width: summary.width,
            height: summary.height,
        },
        subject: None,
        scene_cut_timestamps: summary.scene_cut_timestamps,
        frame_timestamps: Vec::new(),
        source_frame_rate: 30.0,
        has_solid_color_background: false,
        solid_background_color: None,
        static_feature_samples: Vec::new(),
        content_rect: ContentRect::FULL_FRAME,
    })
}

/// Single sequential decode pass that samples face and subject frames from the
/// same decoded packets. Scene-cut histograms are collected at subject cadence.
fn extract_face_and_subjects(
    file_path: String,
    start_time: f64,
    end_time: f64,
    interval_sec: f64,
    face_max_dimension: u32,
    subject_target_width: u32,
    job_id: String,
    frames_dir: PathBuf,
    frames_base_url: String,
    cancelled: Arc<AtomicBool>,
    mut on_progress: impl FnMut(ClipperMediaProgress),
) -> Result<ClipperMediaExtractionSummary, String> {
    let pipeline_started = Instant::now();
    let mut scale_time = Duration::ZERO;
    let mut histogram_time = Duration::ZERO;
    let mut jpeg_time = Duration::ZERO;
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
    let avg_rate = stream.avg_frame_rate();
    let source_frame_rate = if avg_rate.denominator() != 0 {
        avg_rate.numerator() as f64 / avg_rate.denominator() as f64
    } else {
        30.0
    };
    let context = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|e| format!("Decoder context error: {e}"))?;
    let mut decoder = context
        .decoder()
        .video()
        .map_err(|e| format!("Video decoder error: {e}"))?;
    let source_width = decoder.width();
    let source_height = decoder.height();

    let face_scale = (face_max_dimension as f64 / source_width.max(source_height) as f64).min(1.0);
    let face_width = (((source_width as f64 * face_scale).round() as u32).max(2)) & !1;
    let face_height = (((source_height as f64 * face_scale).round() as u32).max(2)) & !1;
    let mut face_scaler = Scaler::get(
        decoder.format(),
        source_width,
        source_height,
        Pixel::RGB24,
        face_width,
        face_height,
        Flags::BILINEAR,
    )
    .map_err(|e| format!("Face scaler error: {e}"))?;

    // AutoFlip's feature stream uses ScaleImageCalculator with target_width=480,
    // preserve_aspect_ratio=true and DEFAULT_WITHOUT_UPSCALE.  In particular,
    // portrait inputs are 480 pixels wide (not 480 pixels high).
    let subject_scale = (subject_target_width as f64 / source_width.max(1) as f64).min(1.0);
    let subject_width = (((source_width as f64 * subject_scale).round() as u32).max(2)) & !1;
    let subject_height = (((source_height as f64 * subject_scale).round() as u32).max(2)) & !1;
    let mut subject_scaler = Scaler::get(
        decoder.format(),
        source_width,
        source_height,
        Pixel::RGB24,
        subject_width,
        subject_height,
        Flags::BILINEAR,
    )
    .map_err(|e| format!("Subject scaler error: {e}"))?;

    let seek_target = (start_time * 1_000_000.0).round() as i64;
    input
        .seek(seek_target, ..seek_target)
        .map_err(|e| format!("Seek error: {e}"))?;
    decoder.flush();

    let interval_sec = interval_sec.max(0.05);
    let expected = ((end_time - start_time).max(0.0) * DETECTION_FPS).ceil() as usize;
    let mut next_detection = start_time;
    let mut next_face = start_time;
    let mut shot_detector = AutoFlipShotBoundaryDetector::new();
    let mut scene_cut_timestamps = Vec::new();
    let mut frame_timestamps = Vec::new();
    // Set when a cut lands between two face samples; carried onto the next
    // emitted face frame so the JS tracking session resets on the new shot.
    let mut pending_face_scene_cut = false;
    let mut solid_background_frames = 0usize;
    let mut solid_background_rgb_sum = (0u64, 0u64, 0u64);
    let mut static_feature_samples = Vec::new();
    let mut border_observations = Vec::new();
    let mut face_frame_count = 0usize;
    let mut face_encoded_bytes = 0usize;
    let mut subject_frame_count = 0usize;
    let mut subject_encoded_bytes = 0usize;
    let mut decoded = ffmpeg::frame::Video::empty();
    let mut eta_tracker = EtaTracker::new();
    let mut seen_keyframe = false;

    'packets: for (packet_stream, packet) in input.packets() {
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
            let relative = (timestamp - start_time).max(0.0);
            frame_timestamps.push(relative);

            // This must run at source cadence; the graph's 15-frame history is
            // measured in decoded frames, not object-detector samples.
            let mut shot_rgb = ffmpeg::frame::Video::empty();
            let scale_started = Instant::now();
            subject_scaler
                .run(&decoded, &mut shot_rgb)
                .map_err(|e| format!("Shot scale error: {e}"))?;
            scale_time += scale_started.elapsed();
            let histogram_started = Instant::now();
            let shot_histogram = compute_autoflip_histogram_raw(
                shot_rgb.data(0),
                shot_rgb.stride(0),
                subject_width as usize,
                subject_height as usize,
            );
            histogram_time += histogram_started.elapsed();
            if shot_detector.push(relative, shot_histogram) {
                scene_cut_timestamps.push(relative);
                pending_face_scene_cut = true;
            }
            let border_features = detect_border_features(
                shot_rgb.data(0),
                shot_rgb.stride(0),
                subject_width as usize,
                subject_height as usize,
            );
            border_observations.push((
                border_features.top_border_px,
                border_features.bottom_border_px,
            ));

            let mut subject_frame_out: Option<SubjectFrame> = None;
            let mut sample_emitted = false;
            if timestamp + 0.001 >= next_detection {
                while next_detection <= timestamp {
                    next_detection += 1.0 / DETECTION_FPS;
                }
                sample_emitted = true;
                // `shot_rgb` is the graph-equivalent 480px feature frame, so
                // reuse it for both AutoFlip static-feature analysis and ML.
                // The former implementation used one 8x8 histogram bin as a
                // proxy for a background; this evaluates colour clusters and
                // border rows instead, matching BorderDetectionCalculator's
                // decision semantics much more closely.
                if border_features.has_solid_background {
                    solid_background_frames += 1;
                    if let Some((r, g, b)) = border_features.solid_background_rgb {
                        solid_background_rgb_sum.0 += r as u64;
                        solid_background_rgb_sum.1 += g as u64;
                        solid_background_rgb_sum.2 += b as u64;
                    }
                }
                static_feature_samples.push(StaticFeatureSample {
                    time: relative,
                    has_solid_color_background: border_features.has_solid_background,
                    solid_background_color: border_features
                        .solid_background_rgb
                        .map(|(r, g, b)| RgbColor { r, g, b }),
                });
                let jpeg_started = Instant::now();
                let (frame, bytes) = clipper_subjects::write_frame(
                    &frames_dir,
                    &frames_base_url,
                    subject_frame_count,
                    relative,
                    &shot_rgb,
                    subject_width,
                    subject_height,
                )?;
                jpeg_time += jpeg_started.elapsed();
                subject_frame_count += 1;
                subject_encoded_bytes += bytes;
                subject_frame_out = Some(frame);
            }

            let mut face_frame_out: Option<ClipperFrame> = None;
            if timestamp + 0.001 >= next_face {
                while next_face <= timestamp {
                    next_face += interval_sec;
                }
                sample_emitted = true;
                let mut face_rgb = ffmpeg::frame::Video::empty();
                let face_scale_started = Instant::now();
                face_scaler
                    .run(&decoded, &mut face_rgb)
                    .map_err(|e| format!("Face scale error: {e}"))?;
                scale_time += face_scale_started.elapsed();
                let jpeg_started = Instant::now();
                let (mut frame, bytes) = clipper_frames::write_frame(
                    &frames_dir,
                    &frames_base_url,
                    face_frame_count,
                    relative,
                    &face_rgb,
                    face_width,
                    face_height,
                )?;
                jpeg_time += jpeg_started.elapsed();
                frame.scene_cut = pending_face_scene_cut;
                pending_face_scene_cut = false;
                face_frame_count += 1;
                face_encoded_bytes += bytes;
                face_frame_out = Some(frame);
            }

            if sample_emitted {
                let eta = eta_tracker.eta_seconds(relative, end_time - start_time);
                let percent = ((relative / (end_time - start_time).max(0.001)) * 100.0)
                    .clamp(0.0, 100.0) as usize;
                on_progress(ClipperMediaProgress {
                    phase: "analyzing".into(),
                    processed_frames: subject_frame_count,
                    expected_frames: expected,
                    percent,
                    timestamp_sec: relative,
                    eta_seconds: eta,
                    face_frame: face_frame_out,
                    subject_frame: subject_frame_out,
                });
            }
        }
    }

    if cancelled.load(Ordering::Acquire) {
        return Err("Native extraction cancelled".into());
    }

    on_progress(ClipperMediaProgress {
        phase: "complete".into(),
        processed_frames: subject_frame_count,
        expected_frames: expected,
        percent: 100,
        timestamp_sec: end_time - start_time,
        eta_seconds: Some(0.0),
        face_frame: None,
        subject_frame: None,
    });

    let has_solid_color_background = subject_frame_count > 0
        && solid_background_frames as f64 / subject_frame_count as f64 >= 0.6;
    let solid_background_color = has_solid_color_background.then(|| RgbColor {
        r: (solid_background_rgb_sum.0 / solid_background_frames.max(1) as u64) as u8,
        g: (solid_background_rgb_sum.1 / solid_background_frames.max(1) as u64) as u8,
        b: (solid_background_rgb_sum.2 / solid_background_frames.max(1) as u64) as u8,
    });
    log::info!(
        "clipper legacy extraction metrics: total_ms={} scale_ms={} histogram_ms={} jpeg_ms={} face_frames={} subject_frames={} jpeg_bytes={}",
        pipeline_started.elapsed().as_millis(), scale_time.as_millis(), histogram_time.as_millis(),
        jpeg_time.as_millis(), face_frame_count, subject_frame_count,
        face_encoded_bytes + subject_encoded_bytes,
    );
    Ok(ClipperMediaExtractionSummary {
        job_id,
        face: ClipperMediaFaceSummary {
            frame_count: face_frame_count,
            encoded_bytes: face_encoded_bytes,
            width: face_width,
            height: face_height,
        },
        subject: Some(ClipperMediaSubjectSummary {
            frame_count: subject_frame_count,
            encoded_bytes: subject_encoded_bytes,
            width: subject_width,
            height: subject_height,
        }),
        scene_cut_timestamps,
        frame_timestamps,
        source_frame_rate: if source_frame_rate.is_finite() && source_frame_rate > 0.0 {
            source_frame_rate
        } else {
            30.0
        },
        has_solid_color_background,
        solid_background_color,
        static_feature_samples,
        content_rect: stable_content_rect(&border_observations, subject_height),
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn extract_clipper_media_blocking(
    file_path: String,
    start_time: f64,
    end_time: f64,
    interval_sec: f64,
    face_max_dimension: u32,
    subject_target_width: u32,
    include_motion: bool,
    job_id: String,
    frames_dir: PathBuf,
    frames_base_url: String,
    cancelled: Arc<AtomicBool>,
    on_progress: impl FnMut(ClipperMediaProgress),
) -> Result<ClipperMediaExtractionSummary, String> {
    if end_time <= start_time {
        return Ok(ClipperMediaExtractionSummary {
            job_id,
            face: ClipperMediaFaceSummary {
                frame_count: 0,
                encoded_bytes: 0,
                width: 0,
                height: 0,
            },
            subject: include_motion.then_some(ClipperMediaSubjectSummary {
                frame_count: 0,
                encoded_bytes: 0,
                width: 0,
                height: 0,
            }),
            scene_cut_timestamps: Vec::new(),
            frame_timestamps: Vec::new(),
            source_frame_rate: 30.0,
            has_solid_color_background: false,
            solid_background_color: None,
            static_feature_samples: Vec::new(),
            content_rect: ContentRect::FULL_FRAME,
        });
    }
    if include_motion {
        extract_face_and_subjects(
            file_path,
            start_time,
            end_time,
            interval_sec,
            face_max_dimension,
            subject_target_width,
            job_id,
            frames_dir,
            frames_base_url,
            cancelled,
            on_progress,
        )
    } else {
        extract_face_only(
            file_path,
            start_time,
            end_time,
            interval_sec,
            face_max_dimension,
            job_id,
            frames_dir,
            frames_base_url,
            cancelled,
            on_progress,
        )
    }
}
