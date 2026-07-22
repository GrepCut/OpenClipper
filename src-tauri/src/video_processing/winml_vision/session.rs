use std::path::Path;

use windows::core::HSTRING;
use windows::AI::MachineLearning::{
    LearningModel, LearningModelDevice, LearningModelSession, LearningModelSessionOptions,
};

use super::error_util::winml_error;
use super::types::{NativeVisionError, SessionConfig};

pub(super) struct Session {
    pub(super) value: LearningModelSession,
    pub(super) config: SessionConfig,
}

impl Session {
    pub(super) fn close(&self) {
        let _ = self.value.Close();
    }
}

/// Creates a session compiled for exactly `bound` frames per call by pinning
/// the model's free "batch" dimension. Precompiled static graphs are the
/// whole point: leaving the dimension free forces DirectML to re-plan on
/// every Evaluate.
pub(super) fn make_bound_session(
    model: &LearningModel,
    device: &LearningModelDevice,
    bound: usize,
) -> windows::core::Result<LearningModelSession> {
    match LearningModelSessionOptions::new().and_then(|options| {
        options.OverrideNamedDimension(&HSTRING::from("batch"), bound as u32)?;
        LearningModelSession::CreateFromModelOnDeviceWithSessionOptions(model, device, &options)
    }) {
        Ok(session) => Ok(session),
        // Fallback for models without the named dimension (or an OS without
        // OverrideNamedDimension): a plain session still works, it just
        // re-plans per shape.
        Err(_) => LearningModelSession::CreateFromModelOnDevice(model, device),
    }
}

pub(super) fn load_model(path: &Path) -> Result<LearningModel, NativeVisionError> {
    LearningModel::LoadFromFilePath(&HSTRING::from(path.as_os_str().to_string_lossy().as_ref()))
        .map_err(|error| winml_error("model_missing", "WinML could not load model", error))
}
