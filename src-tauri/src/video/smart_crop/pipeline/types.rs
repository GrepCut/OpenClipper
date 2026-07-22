use serde::Serialize;

use super::super::shadow::GeneralizationShadowDiagnostics;
use super::super::vision_logic::{AutoFlipFaceDetection, NormalizedBox, PoseSubject, SubjectDetection};
use super::super::internal::{ContentRect, NativeFaceBox};
use super::super::vision::NativeVisionDevice;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFaceSample {
    pub(crate) time: f64,
    pub(crate) faces: Vec<NativeFaceBox>,
    pub(crate) frame_w: u32,
    pub(crate) frame_h: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) scene_cut: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubjectSample {
    pub(crate) time: f64,
    pub(crate) detections: Vec<SubjectDetection>,
    pub(crate) autoflip_faces: Vec<AutoFlipFaceDetection>,
    pub(crate) pose_subjects: Vec<PoseSubject>,
    pub(crate) importance_signals: Vec<NativeImportanceSignalRegion>,
    pub(crate) model_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) scene_cut: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) camera_motion_residual: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reid_embedding: Option<Vec<f32>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportanceSignalRegion {
    #[serde(rename = "box")]
    pub(crate) box_: NormalizedBox,
    pub(crate) kind: &'static str,
    pub(crate) confidence: f32,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbColor {
    pub(crate) r: u8,
    pub(crate) g: u8,
    pub(crate) b: u8,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticFeatureSample {
    pub(crate) time: f64,
    pub(crate) has_solid_color_background: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) solid_background_color: Option<RgbColor>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionMetrics {
    pub(crate) decode_duration_ms: u64,
    pub(crate) inference_duration_ms: u64,
    pub(crate) drain_duration_ms: u64,
    pub(crate) face_inference_ms: u64,
    pub(crate) object_inference_ms: u64,
    pub(crate) pose_inference_ms: u64,
    pub(crate) base_face_passes: usize,
    pub(crate) recovery_face_passes: usize,
    pub(crate) orientation_probe_passes: usize,
    pub(crate) peak_face_queue_depth: usize,
    pub(crate) peak_object_queue_depth: usize,
    pub(crate) encoded_jpeg_bytes: usize,
    pub(crate) tracker_duration_ms: u64,
    pub(crate) tracked_subject_count: usize,
    pub(crate) predicted_subject_count: usize,
    pub(crate) codec_decode_api_ms: u64,
    pub(crate) histogram_ms: u64,
    pub(crate) sample_scale_ms: u64,
    pub(crate) frame_copy_rotate_ms: u64,
    pub(crate) border_analysis_ms: u64,
    pub(crate) queue_wait_ms: u64,
    pub(crate) face_preprocess_ms: u64,
    pub(crate) pose_preprocess_ms: u64,
    pub(crate) decoded_frame_count: usize,
    pub(crate) histogram_sample_count: usize,
    pub(crate) decode_thread_count: usize,
    pub(crate) fast_decode_enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionSummary {
    pub(crate) engine: &'static str,
    pub(crate) face_device: NativeVisionDevice,
    pub(crate) object_device: NativeVisionDevice,
    pub(crate) pose_device: NativeVisionDevice,
    pub(crate) frame_width: u32,
    pub(crate) frame_height: u32,
    pub(crate) face_sample_count: usize,
    pub(crate) subject_sample_count: usize,
    pub(crate) scene_cut_timestamps: Vec<f64>,
    pub(crate) frame_timestamps: Vec<f64>,
    pub(crate) source_frame_rate: f64,
    pub(crate) has_solid_color_background: bool,
    pub(crate) solid_background_color: Option<RgbColor>,
    pub(crate) static_feature_samples: Vec<StaticFeatureSample>,
    pub(crate) content_rect: ContentRect,
    pub(crate) model_version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tracker_version: Option<&'static str>,
    pub(crate) metrics: NativeVisionMetrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) shadow_diagnostics: Option<GeneralizationShadowDiagnostics>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionProgress {
    pub(crate) phase: &'static str,
    pub(crate) percent: usize,
    pub(crate) timestamp_sec: f64,
    pub(crate) eta_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) face_sample: Option<NativeFaceSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) subject_sample: Option<NativeSubjectSample>,
    pub(crate) queued_detections: usize,
}
