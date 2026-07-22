use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::entity::{benchmark_result, benchmark_run, test_clip, test_dataset};
use crate::repository::test_repository::TestKeyframeDto;

pub(crate) const TEST_ARCHIVE_SCHEMA_VERSION: u32 = 1;
pub(crate) const MIN_CLIP_SECONDS: f64 = 3.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTestClipInput {
    pub id: String,
    pub dataset_id: String,
    pub name: String,
    pub source_path: String,
    pub original_file_name: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceAnnotationsResult {
    pub annotation_revision: i32,
    pub keyframes: Vec<TestKeyframeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutBenchmarkResultInput {
    pub id: String,
    pub run_id: String,
    pub clip_id: String,
    pub aspect_id: String,
    pub status: String,
    pub metrics: Value,
    pub details_relative_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestArchiveManifest {
    pub(crate) schema_version: u32,
    pub(crate) dataset: test_dataset::Model,
    pub(crate) clips: Vec<test_clip::Model>,
    pub(crate) keyframes: Vec<ArchiveKeyframe>,
    pub(crate) runs: Vec<benchmark_run::Model>,
    pub(crate) results: Vec<benchmark_result::Model>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveKeyframe {
    pub(crate) clip_id: String,
    pub(crate) keyframe: TestKeyframeDto,
}
