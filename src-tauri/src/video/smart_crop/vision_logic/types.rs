use serde::Serialize;

pub const BLAZE_INPUT_SIZE: usize = 192;
pub const BLAZE_ANCHOR_COUNT: usize = 2304;
pub const MOVENET_INPUT_SIZE: usize = 512;
pub const MOVENET_POSE_COUNT: usize = 6;
pub const MOVENET_KEYPOINT_COUNT: usize = 17;
pub const MOVENET_INSTANCE_SIZE: usize = 56;
pub const YOLOX_INPUT_SIZE: usize = 416;
pub const YOLOX_PREDICTION_COUNT: usize = 3549;
pub const YOLOX_CLASS_COUNT: usize = 80;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    pub x_center: f32,
    pub y_center: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectDetection {
    #[serde(rename = "box")]
    pub box_: NormalizedBox,
    pub label: String,
    pub score: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detector_source: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Keypoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFlipFaceDetection {
    #[serde(rename = "box")]
    pub box_: NormalizedBox,
    pub keypoints: Vec<Keypoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicted: Option<bool>,
    #[serde(skip)]
    pub score: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoseSubject {
    #[serde(rename = "box")]
    pub box_: NormalizedBox,
    pub score: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_box: Option<NormalizedBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub torso_box: Option<NormalizedBox>,
    /** Uses the original conservative decoder thresholds for ByteTrack. */
    #[serde(skip)]
    pub trackable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Letterbox {
    pub scale: f32,
    pub pad_x: f32,
    pub pad_y: f32,
    pub source_width: u32,
    pub source_height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Rotation {
    R0,
    R90,
    R180,
    R270,
}
