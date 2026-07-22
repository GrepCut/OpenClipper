//! Pure preprocessing/postprocessing and policy logic shared by the WinML
//! workers. Keep this module free of WinRT types so it is testable everywhere.

mod blaze;
mod geometry;
mod motion;
mod movenet;
mod recovery;
mod types;
mod yolox;

pub use blaze::{decode_blaze, generate_blaze_anchors, weighted_face_nms};
pub use geometry::{box_iou, stable_sigmoid};
pub use motion::detect_motion_saliency;
pub use movenet::decode_movenet;
pub use recovery::RecoveryPolicy;
pub use types::{
    Anchor, AutoFlipFaceDetection, Keypoint, Letterbox, NormalizedBox, PoseSubject, Rotation,
    SubjectDetection, BLAZE_ANCHOR_COUNT, BLAZE_INPUT_SIZE, MOVENET_INPUT_SIZE,
    MOVENET_INSTANCE_SIZE, MOVENET_KEYPOINT_COUNT, MOVENET_POSE_COUNT, YOLOX_CLASS_COUNT,
    YOLOX_INPUT_SIZE, YOLOX_PREDICTION_COUNT,
};
pub use yolox::decode_yolox;
