//! Shared WinML pipeline constants and internal frame/result types.

use std::sync::Arc;

use super::vision::{NativeVisionDevice, NativeVisionError, BATCH_BOUND};
use super::vision_logic::{AutoFlipFaceDetection, NormalizedBox, PoseSubject, SubjectDetection};

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
    pub recovery_passes: usize,
    pub recovery_pose_passes: usize,
}

pub(crate) enum WorkerResult {
    Face(FaceResult),
    Object(ObjectResult),
    Error(NativeVisionError),
}

/// Work item for the face session: either the base pass over a sampled frame
/// or one high-detail tile cropped from it.
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
    pub pass_count: usize,
    pub extra_duration_ms: u64,
}

/// Work item for the object session: base YOLOX pass, high-detail tile,
/// MoveNet tile recovery, or final pose/motion publish.
pub(crate) struct ObjectJob {
    pub kind: ObjectJobKind,
}

pub(crate) enum ObjectJobKind {
    Base {
        frame: Arc<AnalysisFrame>,
    },
    Tile {
        frame: Arc<AnalysisFrame>,
        base_index: usize,
        offset_x: f32,
        offset_y: f32,
        span_x: f32,
        span_y: f32,
    },
    Finalize {
        frame: Arc<AnalysisFrame>,
        detections: Vec<SubjectDetection>,
        recovery_passes: usize,
        yolox_extra_ms: u64,
        yolox_duration_ms: u64,
        device: NativeVisionDevice,
    },
    PoseTile {
        frame: Arc<AnalysisFrame>,
        base_index: usize,
        offset_x: f32,
        offset_y: f32,
        span_x: f32,
        span_y: f32,
    },
}

pub(crate) struct BaseObjectOutcome {
    pub frame: Arc<AnalysisFrame>,
    pub detections: Vec<SubjectDetection>,
    pub device: NativeVisionDevice,
    pub duration_ms: u64,
}

pub(crate) struct FinalizedObjectBase {
    pub frame: Arc<AnalysisFrame>,
    pub detections: Vec<SubjectDetection>,
    pub poses: Vec<PoseSubject>,
    pub motion_signal: Option<(NormalizedBox, f32)>,
    pub device: NativeVisionDevice,
    pub pose_device: NativeVisionDevice,
    pub duration_ms: u64,
    pub pose_duration_ms: u64,
    pub recovery_passes: usize,
    pub needs_pose_recovery: bool,
}

pub(crate) enum ObjectWorkerMsg {
    Base(BaseObjectOutcome),
    Tile {
        base_index: usize,
        detections: Vec<SubjectDetection>,
        duration_ms: u64,
    },
    FinalizedBase(FinalizedObjectBase),
    PoseTile {
        base_index: usize,
        poses: Vec<PoseSubject>,
        duration_ms: u64,
    },
    Total(usize),
    Error(NativeVisionError),
}

pub(crate) struct PendingObjectRecovery {
    pub base: BaseObjectOutcome,
    pub collected: Vec<SubjectDetection>,
    pub remaining: usize,
    pub pass_count: usize,
    pub extra_duration_ms: u64,
}

pub(crate) struct PendingPoseRecovery {
    pub base: FinalizedObjectBase,
    pub collected: Vec<PoseSubject>,
    pub remaining: usize,
    pub pass_count: usize,
    pub extra_pose_duration_ms: u64,
}
