//! Thin synchronous WinML session wrapper. Instances are created and used on
//! one dedicated MTA worker thread by the native Clipper pipeline.

mod com;
mod device_cache;
mod error_util;
mod model;
mod paths;
mod session;
mod types;
pub use model::WinMlModel;
pub use paths::{fp16_variant_path, resource_paths};
pub use types::*;
