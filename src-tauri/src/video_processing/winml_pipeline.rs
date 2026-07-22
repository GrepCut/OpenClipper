use ffmpeg_next as ffmpeg;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_next::{format::Pixel, media::Type};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Instant;

use super::bytetrack::ByteTracker;
use super::clipper_border::detect_border_features;
use super::clipper_frames::{ensure_ffmpeg_init, should_decode_video_packet, AutoFlipShotBoundaryDetector};
use super::generalization_shadow::{GeneralizationShadowConfig, GeneralizationShadowDiagnostics, GeneralizationShadowRunner};
use super::histogram::compute_autoflip_histogram_raw;
use super::vision_logic::{
    box_iou, AutoFlipFaceDetection, NormalizedBox, PoseSubject, RecoveryPolicy, Rotation,
    SubjectDetection,
};
use super::winml_decode::{canonical_rotation_degrees, copy_rgb, rotate_rgb, sample_due, scaler_dimensions, stream_rotation};
use super::winml_internal::{
    AnalysisFrame, DETECTION_FPS, FACE_BUCKET_INTERVAL, FACE_WORKERS, FaceJob, FaceJobKind,
    FaceResult, FaceWorkerMsg, HISTOGRAM_FPS, MAX_BATCH, ObjectResult, OBJECT_WORKERS, QUEUE_CAPACITY,
    WorkerResult,
};
use super::winml_tracking::{
    face_track_inputs, padded_face_box, pose_track_inputs, stable_content_rect, subject_track_inputs,
    tracked_faces, tracked_poses, tracked_subjects,
};
use super::winml_workers::{spawn_face_policy, spawn_face_worker, spawn_object_worker};
use super::winml_vision::{
    fp16_variant_path, resource_paths, NativeVisionDevice, NativeVisionError, VisionModel,
};

pub use super::winml_internal::{ContentRect, NativeFaceBox};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFaceSample {
    time: f64,
    faces: Vec<NativeFaceBox>,
    frame_w: u32,
    frame_h: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    scene_cut: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubjectSample {
    time: f64,
    detections: Vec<SubjectDetection>,
    autoflip_faces: Vec<AutoFlipFaceDetection>,
    pose_subjects: Vec<PoseSubject>,
    importance_signals: Vec<NativeImportanceSignalRegion>,
    model_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    scene_cut: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    camera_motion_residual: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reid_embedding: Option<Vec<f32>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportanceSignalRegion {
    #[serde(rename = "box")]
    box_: NormalizedBox,
    kind: &'static str,
    confidence: f32,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbColor {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticFeatureSample {
    time: f64,
    has_solid_color_background: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    solid_background_color: Option<RgbColor>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionMetrics {
    decode_duration_ms: u64,
    inference_duration_ms: u64,
    drain_duration_ms: u64,
    face_inference_ms: u64,
    object_inference_ms: u64,
    pose_inference_ms: u64,
    base_face_passes: usize,
    recovery_face_passes: usize,
    orientation_probe_passes: usize,
    peak_face_queue_depth: usize,
    peak_object_queue_depth: usize,
    encoded_jpeg_bytes: usize,
    tracker_duration_ms: u64,
    tracked_subject_count: usize,
    predicted_subject_count: usize,
    codec_decode_api_ms: u64,
    histogram_ms: u64,
    sample_scale_ms: u64,
    frame_copy_rotate_ms: u64,
    border_analysis_ms: u64,
    queue_wait_ms: u64,
    face_preprocess_ms: u64,
    pose_preprocess_ms: u64,
    decoded_frame_count: usize,
    histogram_sample_count: usize,
    decode_thread_count: usize,
    fast_decode_enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionSummary {
    engine: &'static str,
    face_device: NativeVisionDevice,
    object_device: NativeVisionDevice,
    pose_device: NativeVisionDevice,
    frame_width: u32,
    frame_height: u32,
    face_sample_count: usize,
    subject_sample_count: usize,
    scene_cut_timestamps: Vec<f64>,
    frame_timestamps: Vec<f64>,
    source_frame_rate: f64,
    has_solid_color_background: bool,
    solid_background_color: Option<RgbColor>,
    static_feature_samples: Vec<StaticFeatureSample>,
    content_rect: ContentRect,
    model_version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    tracker_version: Option<&'static str>,
    metrics: NativeVisionMetrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    shadow_diagnostics: Option<GeneralizationShadowDiagnostics>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionProgress {
    phase: &'static str,
    percent: usize,
    timestamp_sec: f64,
    eta_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    face_sample: Option<NativeFaceSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subject_sample: Option<NativeSubjectSample>,
    queued_detections: usize,
}

pub fn analyze(
    file_path: String,
    start_time: f64,
    end_time: f64,
    resource_dir: &Path,
    cancelled: Arc<AtomicBool>,
    tracking_enabled: bool,
    mut progress: impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<NativeVisionSummary, NativeVisionError> {
    if end_time <= start_time {
        return Err(NativeVisionError::new(
            "decode_failed",
            "Invalid analysis range",
            true,
        ));
    }
    let resources = resource_paths(resource_dir);
    let face_model_path = resources.face;
    let pose_model_path = resources.pose;
    let yolox_model_path = resources.yolox;
    let yolox_labels_path = resources.yolox_labels;
    let shadow_config = GeneralizationShadowConfig::resolve();
    let mut shadow_runner = GeneralizationShadowRunner::open(
        shadow_config,
        &resources.transnet,
        &resources.osnet,
        &resources.vinet,
    );
    for path in [
        &face_model_path,
        &pose_model_path,
        &yolox_model_path,
        &yolox_labels_path,
    ] {
        if !path.is_file() {
            return Err(NativeVisionError::new(
                "model_missing",
                format!("Missing resource {}", path.display()),
                false,
            ));
        }
    }
    let yolox_labels = std::fs::read_to_string(&yolox_labels_path)
        .map_err(|error| NativeVisionError::new("model_missing", format!("Cannot read YOLOX labels: {error}"), false))?
        .lines()
        .map(str::trim)
        .map(str::to_owned)
        .collect();

    progress(NativeVisionProgress {
        phase: "initializing",
        percent: 0,
        timestamp_sec: 0.0,
        eta_seconds: None,
        face_sample: None,
        subject_sample: None,
        queued_detections: 0,
    })?;
    let face_fp16_path = fp16_variant_path(&face_model_path);
    let (face_worker_count, object_worker_count) = (FACE_WORKERS, OBJECT_WORKERS);
    let face_preprocess_time_us = Arc::new(AtomicU64::new(0));
    let pose_preprocess_time_us = Arc::new(AtomicU64::new(0));
    let yolox_labels: Arc<Vec<String>> = Arc::new(yolox_labels);
    let (face_job_sender, face_job_receiver) =
        crossbeam_channel::bounded::<FaceJob>(QUEUE_CAPACITY);
    let (object_sender, object_receiver) =
        crossbeam_channel::bounded::<Arc<AnalysisFrame>>(QUEUE_CAPACITY);
    let (result_sender, result_receiver) = mpsc::channel();
    let (face_msg_sender, face_msg_receiver) = mpsc::channel();
    let face_workers: Vec<_> = (0..face_worker_count)
        .map(|_| {
            spawn_face_worker(
                face_job_receiver.clone(),
                face_msg_sender.clone(),
                cancelled.clone(),
                face_model_path.clone(),
                face_fp16_path.clone(),
                face_preprocess_time_us.clone(),
            )
        })
        .collect();
    let object_workers: Vec<_> = (0..object_worker_count)
        .map(|_| {
            spawn_object_worker(
                object_receiver.clone(),
                result_sender.clone(),
                cancelled.clone(),
                yolox_model_path.clone(),
                pose_model_path.clone(),
                yolox_labels.clone(),
                pose_preprocess_time_us.clone(),
            )
        })
        .collect();
    drop(face_job_receiver);
    drop(object_receiver);
    let face_policy = spawn_face_policy(
        face_msg_receiver,
        face_job_sender.clone(),
        result_sender,
        cancelled.clone(),
    );

    let decode_started = Instant::now();
    ensure_ffmpeg_init().map_err(|error| {
        NativeVisionError::new("decode_failed", format!("FFmpeg init: {error}"), true)
    })?;
    let mut input = ffmpeg::format::input(&file_path).map_err(|error| {
        NativeVisionError::new("decode_failed", format!("Cannot open video: {error}"), true)
    })?;
    let stream = input
        .streams()
        .best(Type::Video)
        .ok_or_else(|| NativeVisionError::new("decode_failed", "No video stream", true))?;
    let stream_index = stream.index();
    let time_base = stream.time_base();
    let time_base_sec = time_base.numerator() as f64 / time_base.denominator() as f64;
    let avg_rate = stream.avg_frame_rate();
    let source_frame_rate = if avg_rate.denominator() != 0 {
        avg_rate.numerator() as f64 / avg_rate.denominator() as f64
    } else {
        30.0
    };
    let rotation = stream_rotation(&stream);
    let mut context = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Decoder context: {error}"), true)
        })?;
    // H.264 software decode dominates this stage. Full logical parallelism
    // was 15% faster than an eight-thread cap on the reference 1080p60 clip.
    let decode_threads = thread::available_parallelism()
        .map(|value| value.get().max(2))
        .unwrap_or(4);
    context.set_threading(ffmpeg::codec::threading::Config {
        kind: ffmpeg::codec::threading::Type::Frame,
        count: decode_threads,
    });
    let fast_decode_enabled = context.id() == ffmpeg::codec::Id::H264;
    let mut decoder_builder = context.decoder();
    if fast_decode_enabled {
        // Preserve every frame, timestamp and H.264 deblocking result. The
        // codec's FAST paths avoid stricter spec work without changing the
        // sampling policy used by the vision models.
        unsafe {
            (*decoder_builder.as_mut_ptr()).flags2 |= ffmpeg::ffi::AV_CODEC_FLAG2_FAST as i32;
        }
    }
    let mut decoder = decoder_builder.video().map_err(|error| {
        NativeVisionError::new("decode_failed", format!("Video decoder: {error}"), true)
    })?;
    let source_width = decoder.width();
    let source_height = decoder.height();
    let (display_width, display_height) = if matches!(rotation, Rotation::R90 | Rotation::R270) {
        (source_height, source_width)
    } else {
        (source_width, source_height)
    };
    let (sample_raw_width, sample_raw_height) =
        scaler_dimensions(source_width, source_height, rotation, 480);
    let histogram_scale = (192.0 / source_width.max(source_height).max(1) as f64).min(1.0);
    let histogram_width = (((source_width as f64 * histogram_scale).round() as u32).max(2)) & !1;
    let histogram_height = (((source_height as f64 * histogram_scale).round() as u32).max(2)) & !1;
    let mut sample_scaler = Scaler::get(
        decoder.format(),
        source_width,
        source_height,
        Pixel::RGB24,
        sample_raw_width,
        sample_raw_height,
        Flags::BILINEAR,
    )
    .map_err(|error| {
        NativeVisionError::new("decode_failed", format!("Sample scaler: {error}"), true)
    })?;
    // The histogram runs on every decoded frame and only feeds coarse
    // shot-boundary statistics, so nearest-neighbor sampling is enough and
    // far cheaper than a filtered full-frame downscale.
    let mut histogram_scaler = Scaler::get(
        decoder.format(),
        source_width,
        source_height,
        Pixel::RGB24,
        histogram_width,
        histogram_height,
        Flags::POINT,
    )
    .map_err(|error| {
        NativeVisionError::new("decode_failed", format!("Histogram scaler: {error}"), true)
    })?;
    let mut histogram_frame =
        ffmpeg::frame::Video::new(Pixel::RGB24, histogram_width, histogram_height);
    let mut sample_frame =
        ffmpeg::frame::Video::new(Pixel::RGB24, sample_raw_width, sample_raw_height);
    let seek_target = (start_time * 1_000_000.0).round() as i64;
    input
        .seek(seek_target, ..seek_target)
        .map_err(|error| NativeVisionError::new("decode_failed", format!("Seek: {error}"), true))?;
    decoder.flush();

    let mut decoded = ffmpeg::frame::Video::empty();
    let mut next_histogram = start_time;
    let mut next_detection = start_time;
    let mut next_face_bucket = start_time;
    let mut shot_detector = AutoFlipShotBoundaryDetector::for_sample_rate(HISTOGRAM_FPS);
    let mut pending_scene_cut = false;
    let mut scene_cut_timestamps = Vec::new();
    let mut frame_timestamps = Vec::new();
    let mut static_feature_samples = Vec::new();
    let mut border_observations = Vec::new();
    let mut solid_background_frames = 0usize;
    let mut solid_rgb_sum = (0u64, 0u64, 0u64);
    let mut sample_count = 0usize;
    let mut last_border_features: Option<super::clipper_border::BorderFeatures> = None;
    let mut seen_keyframe = false;
    let total_duration = end_time - start_time;
    let mut peak_face_queue = 0usize;
    let mut peak_object_queue = 0usize;

    let mut t_codec_decode_api = 0u128;
    let mut t_histogram = 0u128;
    let mut t_sample_scale = 0u128;
    let mut t_copy_rotate = 0u128;
    let mut t_border = 0u128;
    let mut t_send = 0u128;
    let mut decoded_frame_count = 0usize;
    let mut histogram_sample_count = 0usize;
    {
        // Shared per-frame handler for the packet loop and the end-of-stream
        // drain. Returns Ok(true) when decoding should stop.
        let mut process_decoded =
            |decoded: &ffmpeg::frame::Video| -> Result<bool, NativeVisionError> {
                decoded_frame_count += 1;
                let Some(pts) = decoded.pts() else {
                    return Ok(false);
                };
                let timestamp = pts as f64 * time_base_sec;
                if timestamp >= end_time {
                    return Ok(true);
                }
                if timestamp < start_time {
                    return Ok(false);
                }
                let relative = timestamp - start_time;
                frame_timestamps.push(relative);

                if sample_due(timestamp, &mut next_histogram, HISTOGRAM_FPS) {
                    let started = Instant::now();
                    histogram_scaler
                        .run(decoded, &mut histogram_frame)
                        .map_err(|error| {
                            NativeVisionError::new(
                                "decode_failed",
                                format!("Histogram scale: {error}"),
                                true,
                            )
                        })?;
                    let histogram = compute_autoflip_histogram_raw(
                        histogram_frame.data(0),
                        histogram_frame.stride(0),
                        histogram_width as usize,
                        histogram_height as usize,
                    );
                    if shot_detector.push(relative, histogram) {
                        scene_cut_timestamps.push(relative);
                    }
                    histogram_sample_count += 1;
                    t_histogram += started.elapsed().as_micros();
                }

                if !sample_due(timestamp, &mut next_detection, DETECTION_FPS) {
                    return Ok(false);
                }
                let face_bucket = timestamp + 0.001 >= next_face_bucket;
                if face_bucket {
                    while next_face_bucket <= timestamp + 0.001 {
                        next_face_bucket += FACE_BUCKET_INTERVAL;
                    }
                }
                let started = Instant::now();
                sample_scaler
                    .run(decoded, &mut sample_frame)
                    .map_err(|error| {
                        NativeVisionError::new(
                            "decode_failed",
                            format!("Sample scale: {error}"),
                            true,
                        )
                    })?;
                t_sample_scale += started.elapsed().as_micros();
                let started = Instant::now();
                let raw = copy_rgb(&sample_frame, sample_raw_width, sample_raw_height);
                let (rgb, width, height) =
                    rotate_rgb(raw, sample_raw_width, sample_raw_height, rotation);
                t_copy_rotate += started.elapsed().as_micros();
                let transnet_scene_cut = shadow_runner.push_frame(
                    &rgb,
                    width as usize,
                    height as usize,
                    relative,
                    pending_scene_cut,
                    None,
                    0,
                );
                if transnet_scene_cut {
                    scene_cut_timestamps.push(relative);
                    pending_scene_cut = true;
                }
                let border = if sample_count < 3 || pending_scene_cut || transnet_scene_cut || last_border_features.is_none() {
                    let started = Instant::now();
                    let b = detect_border_features(
                        &rgb,
                        width as usize * 3,
                        width as usize,
                        height as usize,
                    );
                    t_border += started.elapsed().as_micros();
                    last_border_features = Some(b);
                    b
                } else {
                    last_border_features.unwrap()
                };
                border_observations.push((border.top_border_px, border.bottom_border_px));
                if border.has_solid_background {
                    solid_background_frames += 1;
                    if let Some((r, g, b)) = border.solid_background_rgb {
                        solid_rgb_sum.0 += r as u64;
                        solid_rgb_sum.1 += g as u64;
                        solid_rgb_sum.2 += b as u64;
                    }
                }
                static_feature_samples.push(StaticFeatureSample {
                    time: relative,
                    has_solid_color_background: border.has_solid_background,
                    solid_background_color: border.solid_background_rgb.map(|(r, g, b)| RgbColor {
                        r,
                        g,
                        b,
                    }),
                });
                let frame = Arc::new(AnalysisFrame {
                    index: sample_count,
                    time: relative,
                    width,
                    height,
                    display_width,
                    display_height,
                    rgb,
                    face_bucket,
                    scene_cut: std::mem::take(&mut pending_scene_cut),
                });
                let started = Instant::now();
                let base_job = FaceJob {
                    frame: frame.clone(),
                    kind: FaceJobKind::Base,
                };
                let send_failed =
                    face_job_sender.send(base_job).is_err() || object_sender.send(frame).is_err();
                t_send += started.elapsed().as_micros();
                if send_failed {
                    cancelled.store(true, Ordering::Relaxed);
                    return Ok(true);
                }
                sample_count += 1;
                peak_face_queue = peak_face_queue.max(face_job_sender.len());
                peak_object_queue = peak_object_queue.max(object_sender.len());
                let percent = ((relative / total_duration) * 90.0).clamp(0.0, 90.0) as usize;
                if progress(NativeVisionProgress {
                    phase: "decoding",
                    percent,
                    timestamp_sec: relative,
                    eta_seconds: None,
                    face_sample: None,
                    subject_sample: None,
                    queued_detections: sample_count,
                })
                .is_err()
                {
                    cancelled.store(true, Ordering::Relaxed);
                    return Ok(true);
                }
                Ok(false)
            };

        let mut reached_end = false;
        'packets: for (packet_stream, packet) in input.packets() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            if packet_stream.index() != stream_index {
                continue;
            }
            if !should_decode_video_packet(packet.is_key(), seen_keyframe) {
                continue;
            }
            seen_keyframe = true;
            let started = Instant::now();
            let sent = decoder.send_packet(&packet);
            t_codec_decode_api += started.elapsed().as_micros();
            if sent.is_err() {
                continue;
            }
            loop {
                let started = Instant::now();
                let received = decoder.receive_frame(&mut decoded);
                t_codec_decode_api += started.elapsed().as_micros();
                if received.is_err() {
                    break;
                }
                if process_decoded(&decoded)? {
                    reached_end = true;
                    break 'packets;
                }
            }
        }
        // Frame threading keeps a window of frames buffered inside the
        // decoder; drain it so the clip tail is analyzed when the stream
        // ends before end_time.
        if !reached_end && !cancelled.load(Ordering::Relaxed) {
            let started = Instant::now();
            let _ = decoder.send_eof();
            t_codec_decode_api += started.elapsed().as_micros();
            loop {
                let started = Instant::now();
                let received = decoder.receive_frame(&mut decoded);
                t_codec_decode_api += started.elapsed().as_micros();
                if received.is_err() {
                    break;
                }
                if process_decoded(&decoded)? {
                    break;
                }
            }
        }
    }
    let decode_duration_ms = decode_started.elapsed().as_millis() as u64;
    let _ = face_msg_sender.send(FaceWorkerMsg::Total(sample_count));
    drop(face_msg_sender);
    drop(face_job_sender);
    drop(object_sender);
    let drain_started = Instant::now();
    if progress(NativeVisionProgress {
        phase: "draining",
        percent: 90,
        timestamp_sec: total_duration,
        eta_seconds: None,
        face_sample: None,
        subject_sample: None,
        queued_detections: sample_count * 2,
    })
    .is_err()
    {
        cancelled.store(true, Ordering::Relaxed);
    }
    let _ = face_policy.join();
    for worker in face_workers {
        let _ = worker.join();
    }
    for worker in object_workers {
        let _ = worker.join();
    }
    let drain_duration_ms = drain_started.elapsed().as_millis() as u64;
    let face_preprocess_ms = face_preprocess_time_us.load(Ordering::Relaxed) / 1_000;
    let pose_preprocess_ms = pose_preprocess_time_us.load(Ordering::Relaxed) / 1_000;

    let mut face_results = BTreeMap::new();
    let mut object_results = BTreeMap::new();
    let mut first_error = None;
    for result in result_receiver.try_iter() {
        match result {
            WorkerResult::Face(value) => {
                face_results.insert(value.index, value);
            }
            WorkerResult::Object(value) => {
                object_results.insert(value.index, value);
            }
            WorkerResult::Error(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(NativeVisionError::new(
            "cancelled",
            "Native analysis was cancelled",
            false,
        ));
    }
    if face_results.len() != sample_count || object_results.len() != sample_count {
        return Err(NativeVisionError::new(
            "evaluation_failed",
            format!(
                "Incomplete native result set: face {}/{sample_count}, object {}/{sample_count}",
                face_results.len(),
                object_results.len()
            ),
            true,
        ));
    }
    // Raw MoveNet observations are valuable for small/blurred action subjects,
    // but isolated low-confidence poses can also fire on human-shaped scenery.
    // Only bypass ByteTrack's 0.7 new-track gate when pose evidence persists.
    // Pose v3 runs every second person sample, so 30% of all detector samples
    // represents strong clip-level evidence rather than the former 70%.
    let preserve_raw_pose_observations = sample_count > 0
        && object_results
            .values()
            .filter(|result| !result.poses.is_empty())
            .count()
            * 10
            >= sample_count * 3
        && face_results
            .values()
            .filter(|result| !result.faces.is_empty())
            .count()
            * 10
            < sample_count * 3;

    let mut face_samples = Vec::new();
    let mut subject_samples = Vec::with_capacity(sample_count);
    let mut face_device = NativeVisionDevice::Cpu;
    let mut object_device = NativeVisionDevice::Cpu;
    let mut pose_device = NativeVisionDevice::Cpu;
    let mut face_inference_ms = 0;
    let mut object_inference_ms = 0;
    let mut pose_inference_ms = 0;
    let mut recovery_face_passes = 0;
    let tracker_started = Instant::now();
    let mut object_tracker = ByteTracker::new();
    let mut face_tracker = ByteTracker::new();
    let mut pose_tracker = ByteTracker::new();
    let mut tracked_subject_count = 0usize;
    let mut predicted_subject_count = 0usize;
    for index in 0..sample_count {
        let face = face_results
            .remove(&index)
            .expect("validated ordered face result");
        let object = object_results
            .remove(&index)
            .expect("validated ordered object result");
        face_device = face.device;
        object_device = object.device;
        pose_device = object.pose_device;
        face_inference_ms += face.duration_ms;
        recovery_face_passes += face.recovery_passes;
        object_inference_ms += object.duration_ms;
        pose_inference_ms += object.pose_duration_ms;
        if tracking_enabled && face.scene_cut {
            object_tracker.reset();
            face_tracker.reset();
            pose_tracker.reset();
        }
        let autoflip_faces = if tracking_enabled {
            tracked_faces(
                face_tracker.update(face.time, &face_track_inputs(&face.faces)),
                &face.faces,
            )
        } else {
            face.faces
                .iter()
                .filter(|item| item.score >= 0.6)
                .cloned()
                .collect()
        };
        let pose_subjects = if tracking_enabled {
            if preserve_raw_pose_observations {
                // Action footage is deliberately framed from raw torso joints;
                // allowing a rare 0.7 observation to switch this stream to a
                // head-centred track causes a visible mid-clip focus jump.
                object.poses
            } else {
                tracked_poses(
                    pose_tracker.update(object.time, &pose_track_inputs(&object.poses)),
                    &object.poses,
                )
            }
        } else {
            object.poses.clone()
        };
        let (mut detections, camera_motion_residual) = if tracking_enabled {
            let tracked = tracked_subjects(
                object_tracker.update(object.time, &subject_track_inputs(&object.detections)),
            );
            tracked_subject_count += tracked.len();
            predicted_subject_count += tracked
                .iter()
                .filter(|item| item.predicted == Some(true))
                .count();
            (tracked, Some(object_tracker.last_camera_motion()))
        } else {
            (object.detections, None)
        };
        for pose in pose_subjects
            .iter()
            // Raw persistent-action poses already emit a dedicated torso
            // signal. Mirroring them into detections would synthesize a
            // face_full head band and defeat that action framing policy.
            .filter(|pose| pose.predicted != Some(true) && pose.track_id.is_some())
        {
            let overlaps_person = detections.iter().any(|detection| {
                detection.label.eq_ignore_ascii_case("person")
                    && box_iou(detection.box_, pose.box_) >= 0.5
            });
            if !overlaps_person {
                detections.push(SubjectDetection {
                    box_: pose.box_,
                    label: "person".into(),
                    score: pose.score,
                    track_id: pose.track_id,
                    predicted: pose.predicted,
                    detector_source: Some("pose"),
                });
            }
        }
        let person_boxes: Vec<_> = detections
            .iter()
            .filter(|item| item.label.eq_ignore_ascii_case("person"))
            .collect();
        let person_box = person_boxes
            .iter()
            .max_by(|left, right| left.score.partial_cmp(&right.score).unwrap_or(std::cmp::Ordering::Equal))
            .map(|item| item.box_);
        let reid_embedding = shadow_runner.record_reid_context(object.time, person_boxes.len(), person_box);
        let mut importance_signals: Vec<NativeImportanceSignalRegion> = object
            .motion_signal
            .into_iter()
            .map(|(box_, confidence)| NativeImportanceSignalRegion {
                box_,
                kind: "motion",
                confidence,
            })
            .collect();
        if let Some(saliency) = shadow_runner.latest_saliency() {
            importance_signals.push(NativeImportanceSignalRegion {
                box_: saliency.box_,
                kind: "video-saliency",
                confidence: saliency.confidence,
            });
        }
        let subject = NativeSubjectSample {
            time: object.time,
            detections,
            autoflip_faces,
            pose_subjects,
            importance_signals,
            model_id: "clipper-vision-v3-yolox",
            scene_cut: face.scene_cut.then_some(true),
            camera_motion_residual,
            reid_embedding,
        };
        let face_sample = face.face_bucket.then(|| NativeFaceSample {
            time: face.time,
            faces: face
                .faces
                .iter()
                .map(|item| padded_face_box(item, face.display_width, face.display_height))
                .collect(),
            frame_w: face.display_width,
            frame_h: face.display_height,
            scene_cut: face.scene_cut.then_some(true),
        });
        if let Some(sample) = face_sample.clone() {
            face_samples.push(sample);
        }
        subject_samples.push(subject.clone());
        let percent = 90 + ((index + 1) * 10 / sample_count.max(1));
        progress(NativeVisionProgress {
            phase: "inferencing",
            percent,
            timestamp_sec: face.time,
            eta_seconds: None,
            face_sample,
            subject_sample: Some(subject),
            queued_detections: sample_count - index - 1,
        })?;
    }
    let tracker_duration_ms = tracking_enabled
        .then(|| tracker_started.elapsed().as_millis() as u64)
        .unwrap_or(0);
    let inference_duration_ms = face_inference_ms.max(object_inference_ms + pose_inference_ms);
    let has_solid_color_background =
        sample_count > 0 && solid_background_frames as f64 / sample_count as f64 >= 0.6;
    let solid_background_color = has_solid_color_background.then(|| RgbColor {
        r: (solid_rgb_sum.0 / solid_background_frames.max(1) as u64) as u8,
        g: (solid_rgb_sum.1 / solid_background_frames.max(1) as u64) as u8,
        b: (solid_rgb_sum.2 / solid_background_frames.max(1) as u64) as u8,
    });
    progress(NativeVisionProgress {
        phase: "complete",
        percent: 100,
        timestamp_sec: total_duration,
        eta_seconds: Some(0.0),
        face_sample: None,
        subject_sample: None,
        queued_detections: 0,
    })?;
    Ok(NativeVisionSummary {
        engine: "winml",
        face_device,
        object_device,
        pose_device,
        frame_width: display_width,
        frame_height: display_height,
        face_sample_count: face_samples.len(),
        subject_sample_count: subject_samples.len(),
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
        content_rect: stable_content_rect(
            &border_observations,
            if matches!(rotation, Rotation::R90 | Rotation::R270) {
                sample_raw_width
            } else {
                sample_raw_height
            },
        ),
        model_version: "clipper-vision-v3-yolox",
        tracker_version: tracking_enabled.then_some("bytetrack-v1"),
        metrics: NativeVisionMetrics {
            decode_duration_ms,
            inference_duration_ms,
            drain_duration_ms,
            face_inference_ms,
            object_inference_ms,
            pose_inference_ms,
            base_face_passes: sample_count,
            recovery_face_passes,
            orientation_probe_passes: 0,
            peak_face_queue_depth: peak_face_queue,
            peak_object_queue_depth: peak_object_queue,
            encoded_jpeg_bytes: 0,
            tracker_duration_ms,
            tracked_subject_count,
            predicted_subject_count,
            codec_decode_api_ms: (t_codec_decode_api / 1_000) as u64,
            histogram_ms: (t_histogram / 1_000) as u64,
            sample_scale_ms: (t_sample_scale / 1_000) as u64,
            frame_copy_rotate_ms: (t_copy_rotate / 1_000) as u64,
            border_analysis_ms: (t_border / 1_000) as u64,
            queue_wait_ms: (t_send / 1_000) as u64,
            face_preprocess_ms,
            pose_preprocess_ms,
            decoded_frame_count,
            histogram_sample_count,
            decode_thread_count: decode_threads,
            fast_decode_enabled,
        },
        shadow_diagnostics: shadow_runner.finish(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_rotations_only() {
        assert_eq!(canonical_rotation_degrees(90.2), Some(Rotation::R90));
        assert_eq!(canonical_rotation_degrees(-90.0), Some(Rotation::R270));
        assert_eq!(canonical_rotation_degrees(45.0), None);
    }

    #[test]
    fn pixel_rotation_is_clockwise_and_swaps_dimensions() {
        let input = vec![1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0, 6, 0, 0];
        let (output, width, height) = rotate_rgb(input, 2, 3, Rotation::R90);
        assert_eq!((width, height), (3, 2));
        assert_eq!(
            output
                .chunks_exact(3)
                .map(|pixel| pixel[0])
                .collect::<Vec<_>>(),
            vec![5, 3, 1, 6, 4, 2]
        );
    }

    #[test]
    fn timestamp_scheduler_handles_variable_frame_intervals_without_duplicates() {
        let mut next = 0.0;
        let timestamps = [0.0, 0.01, 0.099, 0.101, 0.205, 0.39, 0.401];
        let due: Vec<f64> = timestamps
            .into_iter()
            .filter(|timestamp| sample_due(*timestamp, &mut next, 10.0))
            .collect();
        assert_eq!(due, vec![0.0, 0.099, 0.205, 0.39, 0.401]);
        assert!((next - 0.5).abs() < 1e-9);
    }

    #[test]
    fn low_confidence_pose_is_not_trackable() {
        let pose = PoseSubject {
            box_: super::super::vision_logic::NormalizedBox {
                x: 0.1,
                y: 0.2,
                width: 0.08,
                height: 0.2,
            },
            score: 0.12,
            track_id: None,
            predicted: None,
            head_box: None,
            torso_box: None,
            trackable: false,
        };
        assert!(pose_track_inputs(&[pose]).is_empty());
    }

    /// Debug-only smoke/benchmark hook.
    /// opt in with OPENCLIPPER_WINML_BENCHMARK=<video path> and optionally
    /// OPENCLIPPER_WINML_BENCHMARK_END=<seconds> (default 3.0).
    #[test]
    #[ignore]
    fn benchmark_local_seed_without_persistence() {
        let Ok(file_path) = std::env::var("OPENCLIPPER_WINML_BENCHMARK") else {
            return;
        };
        let end_time = std::env::var("OPENCLIPPER_WINML_BENCHMARK_END")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(3.0);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let started = Instant::now();
        let mut events = Vec::new();
        let summary = analyze(
            file_path,
            0.0,
            end_time,
            root,
            Arc::new(AtomicBool::new(false)),
            true,
            |progress| {
                if progress.face_sample.is_some() || progress.subject_sample.is_some() {
                    events.push(progress);
                }
                Ok(())
            },
        )
        .expect("native benchmark must complete");
        assert!(summary.subject_sample_count > 0);
        assert_eq!(summary.metrics.encoded_jpeg_bytes, 0);
        let report = serde_json::json!({
            "mode": "native-winml-smoke",
            "wallClockMs": started.elapsed().as_millis(),
            "summary": summary,
            "samples": events,
        });
        std::fs::write(
            std::env::temp_dir().join("openclipper-winml-smoke.json"),
            serde_json::to_vec_pretty(&report).expect("serialize report"),
        )
        .expect("write benchmark report");
    }
}
