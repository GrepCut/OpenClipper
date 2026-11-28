//! Thin synchronous WinML session wrapper. Instances are created and used on
//! one dedicated MTA worker thread by the native Clipper pipeline.

mod backend;
mod com;
mod device_cache;
mod error_util;
mod model;
mod ort_model;
mod paths;
mod session;
mod types;
pub use backend::NativeVisionModel;

/// Multi-input graphs share the same bundled runtime and provider selection as vision.
pub(crate) fn open_ort_session(path: &std::path::Path) -> Result<ort::session::Session, NativeVisionError> {
    crate::infra::ort_runtime::ensure_ort_loaded()
        .map_err(|error| NativeVisionError::new("model_missing", error, false))?;
    ort_model::OrtVisionModel::build(path, true).or_else(|_| ort_model::OrtVisionModel::build(path, false))
}
pub use paths::{fp16_variant_path, resource_paths};
pub use types::*;
