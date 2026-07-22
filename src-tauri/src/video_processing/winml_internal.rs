//! Shared WinML pipeline constants and internal frame/result types.

use std::sync::Arc;

use super::vision_logic::{AutoFlipFaceDetection, NormalizedBox, PoseSubject, SubjectDetection};
use super::winml_vision::{BATCH_BOUND, NativeVisionDevice, NativeVisionError};

pub(crate) const DETECTION_FPS: f64 = 3.5;
pub(crate) const HISTOGRAM_FPS: f64 = 3.5;
pub(crate) const FACE_BUCKET_INTERVAL: f64 = 0.5;
pub(crate) const QUEUE_CAPACITY: usize = 16;
/// Frames evaluated per WinML call. Workers batch greedily (whatever is
/// queued, up to this bound) and always pad the tensor to the bound, because
/// sessions are compiled for exactly this batch size (see BATCH_BOUND).
pub(crate) const MAX_BATCH: usize = BATCH_BOUND;

/// One worker per model: batched evaluation saturates the device on its own,
/// and extra concurrent sessions only inflate per-call latency by queueing
/// against each other on the GPU.
pub(crate) const FACE_WORKERS: usize = 1;
pub(crate) const OBJECT_WORKERS: usize = 1;
/** Pose is a contextual fallback, not an unconditional second full detector. */
pub(crate) const POSE_PERSON_SAMPLE_STRIDE: usize = 5;
pub(crate) const POSE_RECOVERY_SAMPLE_STRIDE: usize = 3;
pub(crate) const POSE_PERSON_CONFIDENCE: f32 = 0.25;

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFaceBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone)]
pub(crate) struct AnalysisFrame {
    pub index: usize,
    pub time: f64,
    pub width: u32,
    pub height: u32,
    pub display_width: u32,
    pub display_height: u32,
    pub rgb: Vec<u8>,
    pub face_bucket: bool,
    pub scene_cut: bool,
}

pub(crate) struct FaceResult {
    pub index: usize,
    pub time: f64,
    pub faces: Vec<AutoFlipFaceDetection>,
    pub display_width: u32,
    pub display_height: u32,
    pub face_bucket: bool,
    pub scene_cut: bool,
    pub device: NativeVisionDevice,
    pub duration_ms: u64,
    pub recovery_passes: usize,
}

pub(crate) struct ObjectResult {
    pub index: usize,
    pub time: f64,
    pub detections: Vec<SubjectDetection>,
    pub poses: Vec<PoseSubject>,
    pub motion_signal: Option<(NormalizedBox, f32)>,
    pub device: NativeVisionDevice,
    pub pose_device: NativeVisionDevice,
    pub duration_ms: u64,
    pub pose_duration_ms: u64,
}

pub(crate) enum WorkerResult {
    Face(FaceResult),
    Object(ObjectResult),
    Error(NativeVisionError),
}

/// Work item for the BlazeFace session pool: either the base pass over a
/// sampled frame or one recovery tile cropped from it.
pub(crate) struct FaceJob {
    pub frame: Arc<AnalysisFrame>,
    pub kind: FaceJobKind,
}

pub(crate) enum FaceJobKind {
    Base,
    Tile {
        base_index: usize,
        offset_x: f32,
        offset_y: f32,
        span_x: f32,
        span_y: f32,
    },
}

pub(crate) struct BaseFaceOutcome {
    pub frame: Arc<AnalysisFrame>,
    pub faces: Vec<AutoFlipFaceDetection>,
    pub device: NativeVisionDevice,
    pub duration_ms: u64,
}

pub(crate) enum FaceWorkerMsg {
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

pub(crate) struct PendingRecovery {
    pub base: BaseFaceOutcome,
    pub collected: Vec<AutoFlipFaceDetection>,
    pub remaining: usize,
    pub extra_duration_ms: u64,
}
