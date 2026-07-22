pub mod ffmpeg;
pub mod jobs;
pub mod smart_crop;
pub mod tracking;

pub(crate) use ffmpeg::{
    extract_clipper_segment_to_path_blocking, extract_frame_rgb_at_timestamp,
    probe_video_metadata,
};
pub use jobs::registry::{NativeJobEmitter, NativeJobRegistry};
