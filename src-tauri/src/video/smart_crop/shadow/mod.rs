//! Generalization models (TransNetV2, OSNet, ViNet).
//!
//! ViNet saliency feeds importance signals; TransNet drives scene-cut resets;
//! OSNet embeddings assist multi-person identity fusion. Always enabled when
//! the corresponding ONNX weights exist on disk.

#[cfg(windows)]
mod osnet;
mod preprocess;
#[cfg(windows)]
mod runner;
#[cfg(not(windows))]
mod stub;
mod transnet;
mod types;
#[cfg(windows)]
mod vinet;
#[cfg(windows)]
pub use runner::GeneralizationShadowRunner;
#[cfg(not(windows))]
pub use stub::GeneralizationShadowRunner;
pub use transnet::calibrate_transnet_vs_histogram;
pub use types::*;
