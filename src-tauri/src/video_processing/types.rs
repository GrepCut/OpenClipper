use serde::Serialize;

#[derive(Serialize)]
pub struct SceneGroup {
    pub id: usize,
    #[serde(rename = "startFrameIndex")]
    pub start_frame_index: usize,
    #[serde(rename = "endFrameIndex")]
    pub end_frame_index: usize,
    #[serde(rename = "frameCount")]
    pub frame_count: usize,
    pub color: String,
    #[serde(rename = "boundarySimilarity")]
    pub boundary_similarity: f32,
    #[serde(rename = "startTime")]
    pub start_time: f64,
    #[serde(rename = "endTime")]
    pub end_time: f64,
}
