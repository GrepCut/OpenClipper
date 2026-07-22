//! Pure preprocessing/postprocessing and policy logic shared by the WinML
//! workers. Keep this module free of WinRT types so it is testable everywhere.

mod blaze;
mod geometry;
mod motion;
mod movenet;
mod recovery;
mod types;
mod yolox;

pub use blaze::{decode_blaze, weighted_face_nms};
pub use geometry::box_iou;
pub use motion::detect_motion_saliency;
pub use movenet::decode_movenet;
pub use recovery::RecoveryPolicy;
pub use types::{
    AutoFlipFaceDetection, Keypoint, Letterbox, NormalizedBox, PoseSubject, Rotation,
    SubjectDetection, BLAZE_INPUT_SIZE, MOVENET_INPUT_SIZE, YOLOX_INPUT_SIZE,
};
pub use yolox::decode_yolox;
