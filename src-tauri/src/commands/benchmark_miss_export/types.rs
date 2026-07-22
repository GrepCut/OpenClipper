use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::repository::test_repository::TestKeyframeDto;

pub(crate) const VISIBILITY_MISS_BASE: f64 = 10_000.0;
pub(crate) const CROP_VIEWPORT_RGB: [u8; 3] = [255, 68, 68];
pub(crate) const CROP_VIEWPORT_OUTLINE_RGB: [u8; 3] = [0, 0, 0];
pub(crate) const CROP_VIEWPORT_BORDER_PX: i32 = 3;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NormalizedViewport {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BenchmarkTargetDetail {
    pub(crate) slot: i32,
    pub(crate) coverage_fraction: f64,
    pub(crate) coverage_hit: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BenchmarkFrameDetail {
    pub(crate) timestamp_us: i64,
    pub(crate) all_targets_covered: bool,
    pub(crate) viewports: Vec<NormalizedViewport>,
    pub(crate) targets: Vec<BenchmarkTargetDetail>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestTarget {
    pub(crate) slot: i32,
    pub(crate) coverage_fraction: f64,
    pub(crate) coverage_hit: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestFrame {
    pub(crate) clip_id: String,
    pub(crate) aspect_id: String,
    pub(crate) rank: usize,
    pub(crate) file: String,
    pub(crate) keyframe_timestamp_us: i64,
    pub(crate) timestamp_us: i64,
    pub(crate) timestamp_sec: f64,
    pub(crate) score: f64,
    pub(crate) all_targets_covered: bool,
    pub(crate) targets: Vec<ManifestTarget>,
    pub(crate) viewports: Vec<NormalizedViewport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportManifest {
    pub(crate) run_id: String,
    pub(crate) clip_id: String,
    pub(crate) aspect_id: String,
    pub(crate) exported_at: String,
    pub(crate) selection: &'static str,
    pub(crate) keyframe_count: usize,
    pub(crate) frame_count: usize,
    pub(crate) frames: Vec<ManifestFrame>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunExportManifest {
    pub(crate) run_id: String,
    pub(crate) exported_at: String,
    pub(crate) selection: &'static str,
    pub(crate) result_count: usize,
    pub(crate) frame_count: usize,
    pub(crate) frames: Vec<ManifestFrame>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBenchmarkMissFramesResult {
    pub export_dir: String,
    pub frame_count: usize,
    pub manifest_relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBenchmarkRunMissFramesResult {
    pub export_dir: String,
    pub frame_count: usize,
    pub result_count: usize,
}

#[derive(Clone)]
pub(crate) struct RankedFrame {
    pub(crate) detail: BenchmarkFrameDetail,
    pub(crate) score: f64,
    pub(crate) keyframe_timestamp_us: i64,
}

pub(crate) struct SampledKeyframeFrame {
    pub(crate) keyframe_timestamp_us: i64,
    pub(crate) detail: BenchmarkFrameDetail,
}

pub(crate) struct ExportInput {
    pub(crate) dataset_id: String,
    pub(crate) run_id: String,
    pub(crate) clip_id: String,
    pub(crate) aspect_id: String,
    pub(crate) details_relative_path: String,
    pub(crate) media_relative_path: String,
    pub(crate) keyframes: Vec<TestKeyframeDto>,
    pub(crate) export_dir: PathBuf,
}

pub(crate) struct ExportSyncResult {
    pub(crate) frame_count: usize,
    pub(crate) manifest: ExportManifest,
}
