//! Generalization models (TransNetV2, OSNet, ViNet).
//!
//! ViNet saliency feeds importance signals; TransNet can fuse scene cuts when
//! `CLIPPER_ENABLE_SHADOW=1` or `CLIPPER_USE_TRANSNET_CUTS=1` and weights exist;
//! OSNet embeddings assist multi-person identity fusion.

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
