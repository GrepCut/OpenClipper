use fast_image_resize::{
    images::{Image as FastImage, ImageRef as FastImageRef},
    FilterType as FastFilterType, PixelType as FastPixelType, ResizeAlg, ResizeOptions, Resizer,
};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_next::{format::Pixel, media::Type};
use image::{imageops::FilterType, ImageBuffer, Rgb};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Instant;

use super::bytetrack::{ByteTracker, TrackDetection, TrackOutput};
use super::clipper_border::detect_border_features;
use super::clipper_frames::{should_decode_video_packet, AutoFlipShotBoundaryDetector};
use super::histogram::compute_autoflip_histogram_raw;
use super::vision_logic::{
    box_iou, decode_blaze, decode_movenet, decode_ssd, weighted_face_nms, AutoFlipFaceDetection,
    Letterbox, PoseSubject, RecoveryPolicy, Rotation, SubjectDetection, BLAZE_INPUT_SIZE,
    MOVENET_INPUT_SIZE, SSD_INPUT_SIZE,
};
use super::winml_vision::{
    fp16_variant_path, resource_paths, NativeVisionDevice, NativeVisionError, VisionModel,
    WinMlModel, BATCH_BOUND,
};

const DETECTION_FPS: f64 = 5.0;
const HISTOGRAM_FPS: f64 = 10.0;
const FACE_BUCKET_INTERVAL: f64 = 0.5;
const QUEUE_CAPACITY: usize = 16;
/// Frames evaluated per WinML call. Workers batch greedily (whatever is
/// queued, up to this bound) and always pad the tensor to the bound, because
/// sessions are compiled for exactly this batch size (see BATCH_BOUND).
const MAX_BATCH: usize = BATCH_BOUND;

/// One worker per model: batched evaluation saturates the device on its own,
/// and extra concurrent sessions only inflate per-call latency by queueing
/// against each other on the GPU.
const FACE_WORKERS: usize = 1;
const OBJECT_WORKERS: usize = 1;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFaceBox {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

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
    model_id: &'static str,
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

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
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
    object_preprocess_ms: u64,
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

#[derive(Clone)]
struct AnalysisFrame {
    index: usize,
    time: f64,
    width: u32,
    height: u32,
    display_width: u32,
    display_height: u32,
    rgb: Vec<u8>,
    face_bucket: bool,
    scene_cut: bool,
}

struct FaceResult {
    index: usize,
    time: f64,
    faces: Vec<AutoFlipFaceDetection>,
    display_width: u32,
    display_height: u32,
    face_bucket: bool,
    scene_cut: bool,
    device: NativeVisionDevice,
    duration_ms: u64,
    recovery_passes: usize,
}

struct ObjectResult {
    index: usize,
    time: f64,
    detections: Vec<SubjectDetection>,
    poses: Vec<PoseSubject>,
    device: NativeVisionDevice,
    pose_device: NativeVisionDevice,
    duration_ms: u64,
    pose_duration_ms: u64,
}

enum WorkerResult {
    Face(FaceResult),
    Object(ObjectResult),
    Error(NativeVisionError),
}

fn canonical_rotation_degrees(value: f64) -> Option<Rotation> {
    if !value.is_finite() {
        return None;
    }
    let normalized = ((value.round() as i32 % 360) + 360) % 360;
    match normalized {
        0 => Some(Rotation::R0),
        90 => Some(Rotation::R90),
        180 => Some(Rotation::R180),
        270 => Some(Rotation::R270),
        _ => None,
    }
}

fn stream_rotation(stream: &ffmpeg::Stream<'_>) -> Rotation {
    for side_data in stream.side_data() {
        if side_data.kind() != ffmpeg::codec::packet::side_data::Type::DisplayMatrix {
            continue;
        }
        let data = side_data.data();
        if data.len() < 9 * std::mem::size_of::<i32>() {
            continue;
        }
        let mut matrix = [0i32; 9];
        for (index, value) in matrix.iter_mut().enumerate() {
            *value =
                unsafe { std::ptr::read_unaligned(data.as_ptr().add(index * 4).cast::<i32>()) };
        }
        let counter_clockwise = unsafe { ffmpeg::ffi::av_display_rotation_get(matrix.as_ptr()) };
        if let Some(rotation) = canonical_rotation_degrees(-counter_clockwise) {
            return rotation;
        }
    }
    stream
        .metadata()
        .get("rotate")
        .and_then(|value| value.parse::<f64>().ok())
        .and_then(canonical_rotation_degrees)
        .unwrap_or(Rotation::R0)
}

fn copy_rgb(frame: &ffmpeg::frame::Video, width: u32, height: u32) -> Vec<u8> {
    let row_bytes = width as usize * 3;
    let mut output = vec![0u8; row_bytes * height as usize];
    for y in 0..height as usize {
        let source = &frame.data(0)[y * frame.stride(0)..y * frame.stride(0) + row_bytes];
        output[y * row_bytes..(y + 1) * row_bytes].copy_from_slice(source);
    }
    output
}

fn rotate_rgb(data: Vec<u8>, width: u32, height: u32, rotation: Rotation) -> (Vec<u8>, u32, u32) {
    if rotation == Rotation::R0 {
        return (data, width, height);
    }
    let (out_width, out_height) = match rotation {
        Rotation::R90 | Rotation::R270 => (height, width),
        _ => (width, height),
    };
    let mut output = vec![0u8; out_width as usize * out_height as usize * 3];
    for y in 0..height {
        for x in 0..width {
            let (out_x, out_y) = match rotation {
                Rotation::R0 => (x, y),
                Rotation::R90 => (height - 1 - y, x),
                Rotation::R180 => (width - 1 - x, height - 1 - y),
                Rotation::R270 => (y, width - 1 - x),
            };
            let source = (y as usize * width as usize + x as usize) * 3;
            let destination = (out_y as usize * out_width as usize + out_x as usize) * 3;
            output[destination..destination + 3].copy_from_slice(&data[source..source + 3]);
        }
    }
    (output, out_width, out_height)
}

fn scaler_dimensions(
    source_width: u32,
    source_height: u32,
    rotation: Rotation,
    displayed_target_width: u32,
) -> (u32, u32) {
    let displayed_width = if matches!(rotation, Rotation::R90 | Rotation::R270) {
        source_height
    } else {
        source_width
    };
    let scale = (displayed_target_width as f64 / displayed_width.max(1) as f64).min(1.0);
    let width = (((source_width as f64 * scale).round() as u32).max(2)) & !1;
    let height = (((source_height as f64 * scale).round() as u32).max(2)) & !1;
    (width, height)
}

fn sample_due(timestamp: f64, next_sample: &mut f64, samples_per_second: f64) -> bool {
    if timestamp + 0.001 < *next_sample {
        return false;
    }
    let interval = 1.0 / samples_per_second.max(0.001);
    while *next_sample <= timestamp + 0.001 {
        *next_sample += interval;
    }
    true
}

/// Borrowing view over a frame's RGB pixels, so preprocessing never clones
/// the full sample buffer.
fn rgb_view(frame: &AnalysisFrame) -> ImageBuffer<Rgb<u8>, &[u8]> {
    ImageBuffer::from_raw(frame.width, frame.height, frame.rgb.as_slice())
        .expect("validated RGB frame")
}

fn prepare_ssd_into(
    frame: &AnalysisFrame,
    output: &mut [f32],
    resizer: &mut Resizer,
    resized: &mut FastImage<'static>,
    options: &ResizeOptions,
) -> Result<(), NativeVisionError> {
    let source = FastImageRef::new(
        frame.width,
        frame.height,
        frame.rgb.as_slice(),
        FastPixelType::U8x3,
    )
    .map_err(|error| {
        NativeVisionError::new(
            "preprocess_failed",
            format!("Invalid SSD source image: {error}"),
            true,
        )
    })?;
    resizer.resize(&source, resized, options).map_err(|error| {
        NativeVisionError::new(
            "preprocess_failed",
            format!("SSD resize failed: {error}"),
            true,
        )
    })?;
    debug_assert_eq!(output.len(), resized.buffer().len());
    for (target, &value) in output.iter_mut().zip(resized.buffer()) {
        *target = value as f32;
    }
    Ok(())
}

fn prepare_blaze_into(frame: &AnalysisFrame, input: &mut [f32]) -> Letterbox {
    let size = BLAZE_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let pad_x = (size - width) / 2;
    let pad_y = (size - height) / 2;
    let resized = image::imageops::resize(&rgb_view(frame), width, height, FilterType::Triangle);
    // Letterbox padding stays zero-valued (-1.0 after normalization), exactly
    // like the previous zeroed-canvas overlay.
    input.fill(-1.0);
    let row_len = width as usize * 3;
    for y in 0..height as usize {
        let source_row = &resized.as_raw()[y * row_len..(y + 1) * row_len];
        let destination = ((y + pad_y as usize) * size as usize + pad_x as usize) * 3;
        for (target, &value) in input[destination..destination + row_len]
            .iter_mut()
            .zip(source_row)
        {
            *target = value as f32 / 127.5 - 1.0;
        }
    }
    Letterbox {
        scale,
        pad_x: pad_x as f32,
        pad_y: pad_y as f32,
        source_width: frame.width,
        source_height: frame.height,
    }
}

fn prepare_movenet_into(frame: &AnalysisFrame, input: &mut [f32]) -> Letterbox {
    let size = MOVENET_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let pad_x = (size - width) / 2;
    let pad_y = (size - height) / 2;
    let resized = image::imageops::resize(&rgb_view(frame), width, height, FilterType::Triangle);
    input.fill(0.0);
    let row_len = width as usize * 3;
    for y in 0..height as usize {
        let source_row = &resized.as_raw()[y * row_len..(y + 1) * row_len];
        let destination = ((y + pad_y as usize) * size as usize + pad_x as usize) * 3;
        for (target, &value) in input[destination..destination + row_len]
            .iter_mut()
            .zip(source_row)
        {
            *target = value as f32;
        }
    }
    Letterbox {
        scale,
        pad_x: pad_x as f32,
        pad_y: pad_y as f32,
        source_width: frame.width,
        source_height: frame.height,
    }
}

fn recovery_tiles(frame: &AnalysisFrame) -> Vec<(AnalysisFrame, f32, f32, f32, f32)> {
    let tile_width = ((frame.width as f32 * 0.6).round() as u32).clamp(1, frame.width);
    let tile_height = ((frame.height as f32 * 0.6).round() as u32).clamp(1, frame.height);
    let positions = [
        (0, 0),
        (frame.width - tile_width, 0),
        (0, frame.height - tile_height),
        (frame.width - tile_width, frame.height - tile_height),
    ];
    positions
        .into_iter()
        .map(|(x, y)| {
            let row_bytes = tile_width as usize * 3;
            let mut rgb = vec![0u8; row_bytes * tile_height as usize];
            for row in 0..tile_height as usize {
                let source_start = ((y as usize + row) * frame.width as usize + x as usize) * 3;
                rgb[row * row_bytes..(row + 1) * row_bytes]
                    .copy_from_slice(&frame.rgb[source_start..source_start + row_bytes]);
            }
            (
                AnalysisFrame {
                    index: frame.index,
                    time: frame.time,
                    width: tile_width,
                    height: tile_height,
                    display_width: frame.display_width,
                    display_height: frame.display_height,
                    rgb,
                    face_bucket: frame.face_bucket,
                    scene_cut: frame.scene_cut,
                },
                x as f32 / frame.width as f32,
                y as f32 / frame.height as f32,
                tile_width as f32 / frame.width as f32,
                tile_height as f32 / frame.height as f32,
            )
        })
        .collect()
}

fn map_face_from_tile(
    mut face: AutoFlipFaceDetection,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
) -> AutoFlipFaceDetection {
    face.box_.x = x + face.box_.x * width;
    face.box_.y = y + face.box_.y * height;
    face.box_.width *= width;
    face.box_.height *= height;
    for point in &mut face.keypoints {
        point.x = x + point.x * width;
        point.y = y + point.y * height;
    }
    face
}

/// Work item for the BlazeFace session pool: either the base pass over a
/// sampled frame or one recovery tile cropped from it.
struct FaceJob {
    frame: Arc<AnalysisFrame>,
    kind: FaceJobKind,
}

enum FaceJobKind {
    Base,
    Tile {
        base_index: usize,
        offset_x: f32,
        offset_y: f32,
        span_x: f32,
        span_y: f32,
    },
}

struct BaseFaceOutcome {
    frame: Arc<AnalysisFrame>,
    faces: Vec<AutoFlipFaceDetection>,
    device: NativeVisionDevice,
    duration_ms: u64,
}

enum FaceWorkerMsg {
    Base(BaseFaceOutcome),
    Tile {
        base_index: usize,
        faces: Vec<AutoFlipFaceDetection>,
        duration_ms: u64,
    },
    /// Sent by the decode loop once all frames were queued, so the policy
    /// thread knows when the last base frame has been finalized.
    Total(usize),
    Error(NativeVisionError),
}

fn face_result_from(outcome: BaseFaceOutcome, recovery_passes: usize, extra_ms: u64) -> FaceResult {
    FaceResult {
        index: outcome.frame.index,
        time: outcome.frame.time,
        faces: outcome.faces,
        display_width: outcome.frame.display_width,
        display_height: outcome.frame.display_height,
        face_bucket: outcome.frame.face_bucket,
        scene_cut: outcome.frame.scene_cut,
        device: outcome.device,
        duration_ms: outcome.duration_ms + extra_ms,
        recovery_passes,
    }
}

/// Drains up to MAX_BATCH queued jobs: one blocking receive, then whatever
/// else is already waiting. Under backpressure batches fill up; when the
/// queue is quiet latency stays one frame.
fn drain_batch<T>(jobs: &crossbeam_channel::Receiver<T>, first: T) -> Vec<T> {
    let mut batch = Vec::with_capacity(MAX_BATCH);
    batch.push(first);
    while batch.len() < MAX_BATCH {
        match jobs.try_recv() {
            Ok(job) => batch.push(job),
            Err(_) => break,
        }
    }
    batch
}

/// Per-element output stride of a batched evaluation, or a contract error.
fn batch_stride(len: usize, bound: usize, what: &str) -> Result<usize, NativeVisionError> {
    if bound == 0 || len % bound != 0 {
        return Err(NativeVisionError::new(
            "tensor_contract_mismatch",
            format!("{what} output is not divisible by the batch size"),
            true,
        ));
    }
    Ok(len / bound)
}

/// Stateless BlazeFace evaluator. Frames arrive out of order across the pool;
/// the sequential recovery policy lives in `spawn_face_policy`.
fn spawn_face_worker(
    jobs: crossbeam_channel::Receiver<FaceJob>,
    results: mpsc::Sender<FaceWorkerMsg>,
    cancelled: Arc<AtomicBool>,
    model_path: std::path::PathBuf,
    fp16_model_path: std::path::PathBuf,
    preprocess_time_us: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut model: Option<WinMlModel> = None;
        let frame_elems = BLAZE_INPUT_SIZE * BLAZE_INPUT_SIZE * 3;
        let mut input = vec![-1.0f32; MAX_BATCH * frame_elems];
        let mut letterboxes = Vec::with_capacity(MAX_BATCH);
        'jobs: while let Ok(first) = jobs.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let batch = drain_batch(&jobs, first);
            let count = batch.len();
            // Sessions are compiled for batch sizes 1 and MAX_BATCH only;
            // multi-frame batches are padded up to the bound. Padding
            // elements keep the letterbox fill value (-1.0) and their
            // outputs are ignored below.
            let bound = if count == 1 { 1 } else { MAX_BATCH };
            let preprocess_started = Instant::now();
            let input = &mut input[..bound * frame_elems];
            input.fill(-1.0);
            letterboxes.clear();
            for (index, job) in batch.iter().enumerate() {
                let letterbox = prepare_blaze_into(
                    &job.frame,
                    &mut input[index * frame_elems..(index + 1) * frame_elems],
                );
                letterboxes.push(letterbox);
            }
            preprocess_time_us.fetch_add(
                preprocess_started.elapsed().as_micros() as u64,
                Ordering::Relaxed,
            );
            let shape = [bound as i64, 192, 192, 3];
            let started = Instant::now();
            let evaluated = if let Some(current) = model.as_mut() {
                current
                    .evaluate(&shape, input)
                    .map(|output| (output, current.device()))
            } else {
                WinMlModel::create(
                    VisionModel::Face,
                    &model_path,
                    Some(&fp16_model_path),
                    "input",
                    &["reshaped_regressor_face_4", "reshaped_classifier_face_4"],
                    &shape,
                    input,
                )
                .map(|(created, output)| {
                    let device = created.device();
                    model = Some(created);
                    (output, device)
                })
            };
            match evaluated.and_then(|(output, device)| {
                if output.len() != 2 {
                    return Err(NativeVisionError::new(
                        "tensor_contract_mismatch",
                        "BlazeFace output count changed",
                        true,
                    ));
                }
                let regressor_stride = batch_stride(output[0].len(), bound, "BlazeFace")?;
                let logits_stride = batch_stride(output[1].len(), bound, "BlazeFace")?;
                let mut outcomes = Vec::with_capacity(count);
                for index in 0..count {
                    let faces = decode_blaze(
                        &output[0][index * regressor_stride..(index + 1) * regressor_stride],
                        &output[1][index * logits_stride..(index + 1) * logits_stride],
                        letterboxes[index],
                        0.55,
                    )
                    .map_err(|message| {
                        NativeVisionError::new("tensor_contract_mismatch", message, true)
                    })?;
                    outcomes.push(faces);
                }
                Ok((outcomes, device))
            }) {
                Ok((outcomes, device)) => {
                    let duration_ms = started.elapsed().as_millis() as u64 / count as u64;
                    for (job, faces) in batch.into_iter().zip(outcomes) {
                        let message = match job.kind {
                            FaceJobKind::Base => FaceWorkerMsg::Base(BaseFaceOutcome {
                                frame: job.frame,
                                faces,
                                device,
                                duration_ms,
                            }),
                            FaceJobKind::Tile {
                                base_index,
                                offset_x,
                                offset_y,
                                span_x,
                                span_y,
                            } => FaceWorkerMsg::Tile {
                                base_index,
                                faces: faces
                                    .into_iter()
                                    .map(|face| {
                                        map_face_from_tile(face, offset_x, offset_y, span_x, span_y)
                                    })
                                    .collect(),
                                duration_ms,
                            },
                        };
                        if results.send(message).is_err() {
                            break 'jobs;
                        }
                    }
                }
                Err(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(FaceWorkerMsg::Error(error));
                    break;
                }
            }
        }
    })
}

struct PendingRecovery {
    base: BaseFaceOutcome,
    collected: Vec<AutoFlipFaceDetection>,
    remaining: usize,
    extra_duration_ms: u64,
}

/// Reorders pooled base-pass results back into frame order and applies the
/// sequential recovery policy exactly like the previous single-worker loop:
/// scene resets, miss counters, and tile recovery all observe frames in
/// order, while the tile evaluations themselves run on the worker pool.
fn spawn_face_policy(
    incoming: mpsc::Receiver<FaceWorkerMsg>,
    jobs: crossbeam_channel::Sender<FaceJob>,
    results: mpsc::Sender<WorkerResult>,
    cancelled: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut policy = RecoveryPolicy::default();
        policy.new_scene();
        let mut had_track = false;
        let mut reorder: BTreeMap<usize, BaseFaceOutcome> = BTreeMap::new();
        let mut next_index = 0usize;
        let mut finalized = 0usize;
        let mut total: Option<usize> = None;
        let mut recovery: Option<PendingRecovery> = None;

        'policy: while total != Some(finalized) {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let Ok(message) = incoming.recv() else {
                break;
            };
            match message {
                FaceWorkerMsg::Total(count) => total = Some(count),
                FaceWorkerMsg::Error(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(WorkerResult::Error(error));
                    break;
                }
                FaceWorkerMsg::Base(outcome) => {
                    reorder.insert(outcome.frame.index, outcome);
                }
                FaceWorkerMsg::Tile {
                    base_index,
                    faces,
                    duration_ms,
                } => {
                    let Some(pending) = recovery.as_mut() else {
                        continue;
                    };
                    debug_assert_eq!(pending.base.frame.index, base_index);
                    pending.collected.extend(faces);
                    pending.extra_duration_ms += duration_ms;
                    pending.remaining -= 1;
                    if pending.remaining == 0 {
                        let mut done = recovery.take().expect("checked pending recovery");
                        done.base.faces.append(&mut done.collected);
                        done.base.faces =
                            weighted_face_nms(std::mem::take(&mut done.base.faces), 0.4);
                        had_track = !done.base.faces.is_empty();
                        let recovery_passes = 4;
                        if results
                            .send(WorkerResult::Face(face_result_from(
                                done.base,
                                recovery_passes,
                                done.extra_duration_ms,
                            )))
                            .is_err()
                        {
                            break 'policy;
                        }
                        finalized += 1;
                        next_index += 1;
                    }
                }
            }
            // Advance through in-order base results until one needs recovery
            // (its tiles must finish before the next frame may be observed).
            while recovery.is_none() {
                let Some(outcome) = reorder.remove(&next_index) else {
                    break;
                };
                if outcome.frame.scene_cut {
                    policy.new_scene();
                    had_track = false;
                }
                let should_recover = policy.observe(
                    outcome.frame.time,
                    outcome.frame.face_bucket,
                    !outcome.faces.is_empty(),
                    false,
                    had_track,
                );
                if should_recover {
                    let tiles = recovery_tiles(&outcome.frame);
                    let tile_count = tiles.len();
                    for (tile, offset_x, offset_y, span_x, span_y) in tiles {
                        let job = FaceJob {
                            frame: Arc::new(tile),
                            kind: FaceJobKind::Tile {
                                base_index: outcome.frame.index,
                                offset_x,
                                offset_y,
                                span_x,
                                span_y,
                            },
                        };
                        if jobs.send(job).is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                            break 'policy;
                        }
                    }
                    recovery = Some(PendingRecovery {
                        base: outcome,
                        collected: Vec::new(),
                        remaining: tile_count,
                        extra_duration_ms: 0,
                    });
                } else {
                    had_track = !outcome.faces.is_empty();
                    if results
                        .send(WorkerResult::Face(face_result_from(outcome, 0, 0)))
                        .is_err()
                    {
                        break 'policy;
                    }
                    finalized += 1;
                    next_index += 1;
                }
            }
        }
    })
}

fn spawn_object_worker(
    jobs: crossbeam_channel::Receiver<Arc<AnalysisFrame>>,
    results: mpsc::Sender<WorkerResult>,
    cancelled: Arc<AtomicBool>,
    model_path: std::path::PathBuf,
    fp16_model_path: std::path::PathBuf,
    pose_model_path: std::path::PathBuf,
    labels: Arc<Vec<String>>,
    tracking_enabled: bool,
    preprocess_time_us: Arc<AtomicU64>,
    pose_preprocess_time_us: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut model: Option<WinMlModel> = None;
        let mut pose_model: Option<WinMlModel> = None;
        let frame_elems = SSD_INPUT_SIZE * SSD_INPUT_SIZE * 3;
        let mut input = vec![0.0f32; MAX_BATCH * frame_elems];
        let mut resizer = Resizer::new();
        let mut resized = FastImage::new(
            SSD_INPUT_SIZE as u32,
            SSD_INPUT_SIZE as u32,
            FastPixelType::U8x3,
        );
        // `image`'s Triangle resize applies a bilinear convolution kernel
        // across the complete downscale footprint. Keep that anti-aliasing
        // policy while using FIR's SIMD implementation and reusable buffers.
        let resize_options =
            ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FastFilterType::Bilinear));
        while let Ok(first) = jobs.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let batch = drain_batch(&jobs, first);
            let count = batch.len();
            let bound = if count == 1 { 1 } else { MAX_BATCH };
            let preprocess_started = Instant::now();
            let input = &mut input[..bound * frame_elems];
            input.fill(0.0);
            for (index, frame) in batch.iter().enumerate() {
                if let Err(error) = prepare_ssd_into(
                    frame,
                    &mut input[index * frame_elems..(index + 1) * frame_elems],
                    &mut resizer,
                    &mut resized,
                    &resize_options,
                ) {
                    let _ = results.send(WorkerResult::Error(error));
                    return;
                }
            }
            preprocess_time_us.fetch_add(
                preprocess_started.elapsed().as_micros() as u64,
                Ordering::Relaxed,
            );
            let shape = [bound as i64, 320, 320, 3];
            let started = Instant::now();
            let evaluated = if let Some(current) = model.as_mut() {
                current
                    .evaluate(&shape, input)
                    .map(|output| (output, current.device()))
            } else {
                WinMlModel::create(
                    VisionModel::Object,
                    &model_path,
                    Some(&fp16_model_path),
                    "normalized_input_image_tensor",
                    &["raw_outputs/box_encodings", "raw_outputs/class_predictions"],
                    &shape,
                    input,
                )
                .map(|(created, output)| {
                    let device = created.device();
                    model = Some(created);
                    (output, device)
                })
            };
            match evaluated.and_then(|(output, device)| {
                if output.len() != 2 {
                    return Err(NativeVisionError::new(
                        "tensor_contract_mismatch",
                        "SSD output count changed",
                        true,
                    ));
                }
                let box_stride = batch_stride(output[0].len(), bound, "SSD")?;
                let class_stride = batch_stride(output[1].len(), bound, "SSD")?;
                let mut outcomes = Vec::with_capacity(count);
                for index in 0..count {
                    let detections = decode_ssd(
                        &output[0][index * box_stride..(index + 1) * box_stride],
                        &output[1][index * class_stride..(index + 1) * class_stride],
                        &labels,
                        if tracking_enabled { 0.1 } else { 0.6 },
                    )
                    .map_err(|message| {
                        NativeVisionError::new("tensor_contract_mismatch", message, true)
                    })?;
                    outcomes.push(detections);
                }
                Ok((outcomes, device))
            }) {
                Ok((outcomes, device)) => {
                    let duration_ms = started.elapsed().as_millis() as u64 / count as u64;
                    for (frame, detections) in batch.into_iter().zip(outcomes) {
                        let pose_preprocess_started = Instant::now();
                        let mut pose_input =
                            vec![0.0f32; MOVENET_INPUT_SIZE * MOVENET_INPUT_SIZE * 3];
                        let letterbox = prepare_movenet_into(&frame, &mut pose_input);
                        pose_preprocess_time_us.fetch_add(
                            pose_preprocess_started.elapsed().as_micros() as u64,
                            Ordering::Relaxed,
                        );
                        let pose_shape =
                            [1, MOVENET_INPUT_SIZE as i64, MOVENET_INPUT_SIZE as i64, 3];
                        let pose_started = Instant::now();
                        let evaluated_pose = if let Some(current) = pose_model.as_mut() {
                            current
                                .evaluate(&pose_shape, &pose_input)
                                .map(|output| (output, current.device()))
                        } else {
                            WinMlModel::create(
                                VisionModel::Pose,
                                &pose_model_path,
                                None,
                                "input",
                                &["output_0"],
                                &pose_shape,
                                &pose_input,
                            )
                            .map(|(created, output)| {
                                let pose_device = created.device();
                                pose_model = Some(created);
                                (output, pose_device)
                            })
                        };
                        let (poses, pose_device) =
                            match evaluated_pose.and_then(|(output, pose_device)| {
                                if output.len() != 1 {
                                    return Err(NativeVisionError::new(
                                        "tensor_contract_mismatch",
                                        "MoveNet output count changed",
                                        true,
                                    ));
                                }
                                decode_movenet(&output[0], letterbox)
                                    .map(|poses| (poses, pose_device))
                                    .map_err(|message| {
                                        NativeVisionError::new(
                                            "tensor_contract_mismatch",
                                            message,
                                            true,
                                        )
                                    })
                            }) {
                                Ok(value) => value,
                                Err(error) => {
                                    cancelled.store(true, Ordering::Relaxed);
                                    let _ = results.send(WorkerResult::Error(error));
                                    return;
                                }
                            };
                        let _ = results.send(WorkerResult::Object(ObjectResult {
                            index: frame.index,
                            time: frame.time,
                            detections,
                            poses,
                            device,
                            pose_device,
                            duration_ms,
                            pose_duration_ms: pose_started.elapsed().as_millis() as u64,
                        }));
                    }
                }
                Err(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(WorkerResult::Error(error));
                    break;
                }
            }
        }
    })
}

fn stable_content_rect(observations: &[(u32, u32)], frame_height: u32) -> ContentRect {
    if observations.is_empty() || frame_height == 0 {
        return ContentRect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        };
    }
    let stable = |top: bool| {
        let present = observations
            .iter()
            .filter(|value| if top { value.0 > 0 } else { value.1 > 0 })
            .count();
        if present * 10 < observations.len() * 9 {
            return 0;
        }
        let mut values: Vec<u32> = observations
            .iter()
            .map(|value| if top { value.0 } else { value.1 })
            .collect();
        values.sort_unstable();
        values[values.len() / 2]
    };
    let top = stable(true).min(frame_height.saturating_sub(1));
    let bottom = stable(false).min(frame_height.saturating_sub(top + 1));
    ContentRect {
        x: 0.0,
        y: top as f32 / frame_height as f32,
        width: 1.0,
        height: (frame_height - top - bottom) as f32 / frame_height as f32,
    }
}

fn padded_face_box(face: &AutoFlipFaceDetection, width: u32, height: u32) -> NativeFaceBox {
    let padding_x = face.box_.width * 0.08;
    let padding_y = face.box_.height * 0.08;
    let left = (face.box_.x - padding_x).clamp(0.0, 1.0);
    let top = (face.box_.y - padding_y).clamp(0.0, 1.0);
    let right = (face.box_.x + face.box_.width + padding_x).clamp(0.0, 1.0);
    let bottom = (face.box_.y + face.box_.height + padding_y).clamp(0.0, 1.0);
    NativeFaceBox {
        x: left * width as f32,
        y: top * height as f32,
        width: (right - left) * width as f32,
        height: (bottom - top) * height as f32,
    }
}

fn subject_track_inputs(detections: &[SubjectDetection]) -> Vec<TrackDetection> {
    detections
        .iter()
        .enumerate()
        .map(|(source_index, detection)| TrackDetection {
            box_: detection.box_,
            label: detection.label.clone(),
            score: detection.score,
            source_index,
        })
        .collect()
}

fn face_track_inputs(faces: &[AutoFlipFaceDetection]) -> Vec<TrackDetection> {
    faces
        .iter()
        .enumerate()
        .map(|(source_index, face)| TrackDetection {
            box_: face.box_,
            label: "face".into(),
            score: face.score,
            source_index,
        })
        .collect()
}

fn pose_track_inputs(poses: &[PoseSubject]) -> Vec<TrackDetection> {
    poses
        .iter()
        .enumerate()
        .filter(|(_, pose)| pose.trackable)
        .map(|(source_index, pose)| TrackDetection {
            box_: pose.box_,
            label: "pose-person".into(),
            score: pose.score,
            source_index,
        })
        .collect()
}

fn tracked_subjects(outputs: Vec<TrackOutput>) -> Vec<SubjectDetection> {
    outputs
        .into_iter()
        .map(|output| SubjectDetection {
            box_: output.box_,
            label: output.label,
            score: output.score,
            track_id: Some(output.track_id),
            predicted: output.predicted.then_some(true),
        })
        .collect()
}

fn remap_face_box(
    face: &AutoFlipFaceDetection,
    target: super::vision_logic::NormalizedBox,
) -> AutoFlipFaceDetection {
    let source = face.box_;
    let map_x = |value: f32| {
        if source.width <= 1e-6 {
            target.x
        } else {
            (target.x + (value - source.x) / source.width * target.width).clamp(0.0, 1.0)
        }
    };
    let map_y = |value: f32| {
        if source.height <= 1e-6 {
            target.y
        } else {
            (target.y + (value - source.y) / source.height * target.height).clamp(0.0, 1.0)
        }
    };
    AutoFlipFaceDetection {
        box_: target,
        keypoints: face
            .keypoints
            .iter()
            .map(|point| super::vision_logic::Keypoint {
                x: map_x(point.x),
                y: map_y(point.y),
            })
            .collect(),
        score: face.score,
    }
}

fn tracked_faces(
    outputs: Vec<TrackOutput>,
    faces: &[AutoFlipFaceDetection],
) -> Vec<AutoFlipFaceDetection> {
    outputs
        .into_iter()
        .map(
            |output| match output.source_index.and_then(|index| faces.get(index)) {
                Some(face) => remap_face_box(face, output.box_),
                None => AutoFlipFaceDetection {
                    box_: output.box_,
                    keypoints: Vec::new(),
                    score: output.score,
                },
            },
        )
        .collect()
}

fn remap_child_box(
    child: Option<super::vision_logic::NormalizedBox>,
    source: super::vision_logic::NormalizedBox,
    target: super::vision_logic::NormalizedBox,
) -> Option<super::vision_logic::NormalizedBox> {
    let child = child?;
    if source.width <= 1e-6 || source.height <= 1e-6 {
        return None;
    }
    Some(super::vision_logic::NormalizedBox {
        x: (target.x + (child.x - source.x) / source.width * target.width).clamp(0.0, 1.0),
        y: (target.y + (child.y - source.y) / source.height * target.height).clamp(0.0, 1.0),
        width: (child.width / source.width * target.width).clamp(0.0, 1.0),
        height: (child.height / source.height * target.height).clamp(0.0, 1.0),
    })
}

fn tracked_poses(outputs: Vec<TrackOutput>, poses: &[PoseSubject]) -> Vec<PoseSubject> {
    const POSE_TRACK_ID_OFFSET: u64 = 1_000_000;
    outputs
        .into_iter()
        .map(|output| {
            if let Some(source) = output.source_index.and_then(|index| poses.get(index)) {
                PoseSubject {
                    box_: output.box_,
                    score: output.score,
                    track_id: Some(POSE_TRACK_ID_OFFSET + output.track_id),
                    predicted: output.predicted.then_some(true),
                    head_box: remap_child_box(source.head_box, source.box_, output.box_),
                    torso_box: remap_child_box(source.torso_box, source.box_, output.box_),
                    trackable: true,
                }
            } else {
                PoseSubject {
                    box_: output.box_,
                    score: output.score,
                    track_id: Some(POSE_TRACK_ID_OFFSET + output.track_id),
                    predicted: Some(true),
                    head_box: None,
                    torso_box: Some(super::vision_logic::NormalizedBox {
                        x: output.box_.x + output.box_.width * 0.2,
                        y: output.box_.y + output.box_.height * 0.2,
                        width: output.box_.width * 0.6,
                        height: output.box_.height * 0.45,
                    }),
                    trackable: true,
                }
            }
        })
        .collect()
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
    let (face_model_path, object_model_path, pose_model_path, labels_path) =
        resource_paths(resource_dir);
    for path in [
        &face_model_path,
        &object_model_path,
        &pose_model_path,
        &labels_path,
    ] {
        if !path.is_file() {
            return Err(NativeVisionError::new(
                "model_missing",
                format!("Missing resource {}", path.display()),
                false,
            ));
        }
    }
    let labels = std::fs::read_to_string(&labels_path)
        .map_err(|error| {
            NativeVisionError::new(
                "model_missing",
                format!("Cannot read label map: {error}"),
                false,
            )
        })?
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
    let object_fp16_path = fp16_variant_path(&object_model_path);
    let (face_worker_count, object_worker_count) = (FACE_WORKERS, OBJECT_WORKERS);
    let face_preprocess_time_us = Arc::new(AtomicU64::new(0));
    let object_preprocess_time_us = Arc::new(AtomicU64::new(0));
    let pose_preprocess_time_us = Arc::new(AtomicU64::new(0));
    let labels: Arc<Vec<String>> = Arc::new(labels);
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
                object_model_path.clone(),
                object_fp16_path.clone(),
                pose_model_path.clone(),
                labels.clone(),
                tracking_enabled,
                object_preprocess_time_us.clone(),
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
    ffmpeg::init().map_err(|error| {
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
                        pending_scene_cut = true;
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
                let started = Instant::now();
                let border = detect_border_features(
                    &rgb,
                    width as usize * 3,
                    width as usize,
                    height as usize,
                );
                t_border += started.elapsed().as_micros();
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
    let object_preprocess_ms = object_preprocess_time_us.load(Ordering::Relaxed) / 1_000;
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
    // Only bypass ByteTrack's 0.7 new-track gate when pose evidence persists
    // through most of the clip.
    let preserve_raw_pose_observations = sample_count > 0
        && object_results
            .values()
            .filter(|result| !result.poses.is_empty())
            .count()
            * 10
            >= sample_count * 7
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
        let mut detections = if tracking_enabled {
            let tracked = tracked_subjects(
                object_tracker.update(object.time, &subject_track_inputs(&object.detections)),
            );
            tracked_subject_count += tracked.len();
            predicted_subject_count += tracked
                .iter()
                .filter(|item| item.predicted == Some(true))
                .count();
            tracked
        } else {
            object.detections
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
            object.poses
        };
        for pose in pose_subjects
            .iter()
            // Raw persistent-action poses already emit a dedicated torso
            // signal. Mirroring them into SSD detections would synthesize a
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
                });
            }
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
        let subject = NativeSubjectSample {
            time: object.time,
            detections,
            autoflip_faces,
            pose_subjects,
            model_id: "clipper-vision-v2",
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
        model_version: "clipper-vision-v2",
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
            object_preprocess_ms,
            pose_preprocess_ms,
            decoded_frame_count,
            histogram_sample_count,
            decode_thread_count: decode_threads,
            fast_decode_enabled,
        },
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

    /// Debug-only smoke/benchmark hook. It never persists application data;
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
