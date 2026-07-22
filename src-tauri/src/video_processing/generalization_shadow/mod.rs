//! Generalization models (TransNetV2, OSNet, ViNet).
//!
//! ViNet saliency feeds importance signals; TransNet drives scene-cut resets;
//! OSNet embeddings assist multi-person identity fusion. Always enabled when
//! the corresponding ONNX weights exist on disk.

mod types;
mod preprocess;
mod transnet;
#[cfg(windows)]
mod vinet;
#[cfg(windows)]
mod osnet;
#[cfg(windows)]
mod runner;
#[cfg(not(windows))]
mod stub;
pub use types::*;
pub use transnet::calibrate_transnet_vs_histogram;
#[cfg(windows)]
pub use runner::GeneralizationShadowRunner;
#[cfg(not(windows))]
pub use stub::GeneralizationShadowRunner;
