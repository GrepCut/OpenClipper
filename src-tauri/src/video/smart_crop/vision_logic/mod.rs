//! Pure preprocessing/postprocessing and policy logic shared by the WinML
//! workers. Keep this module free of WinRT types so it is testable everywhere.

#[cfg(windows)]
mod face_detector;
mod geometry;
mod motion;
mod movenet;
#[cfg(windows)]
mod multiscale;
mod recovery;
mod types;
mod yolox;
#[cfg(windows)]
mod yunet;

#[cfg(windows)]
pub(crate) use face_detector::{
    decode_canvas_view, decode_single_view, fuse_views, FaceViewShape, FACE_CANVAS,
    FACE_CANVAS_INPUT, FACE_CANVAS_OUTPUTS, FACE_CANVAS_VIEWS, FACE_SINGLE_VIEWS, FACE_VIEW_INPUT,
    FACE_VIEW_OUTPUTS,
};
pub use geometry::box_iou;
pub use motion::detect_motion_saliency;
pub use movenet::decode_movenet;
#[cfg(windows)]
pub use multiscale::weighted_face_nms;
pub use recovery::RecoveryPolicy;
pub use types::{
    AutoFlipFaceDetection, Keypoint, Letterbox, NormalizedBox, PoseSubject, Rotation,
    SubjectDetection, FACE_TILE_SIZE, MOVENET_INPUT_SIZE, YOLOX_INPUT_SIZE,
};
pub use yolox::{decode_yolox_fast, merge_subject_detections};
