use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use super::model::WinMlModel;
use super::ort_model::OrtVisionModel;
use super::types::{NativeVisionDevice, NativeVisionError, VisionModel};

/// Model kinds the OS WinML already failed to load in this process; later
/// creations go straight to ORT instead of re-running WinML calibration.
static WINML_UNSUPPORTED: OnceLock<Mutex<HashSet<VisionModel>>> = OnceLock::new();

fn winml_unsupported() -> &'static Mutex<HashSet<VisionModel>> {
    WINML_UNSUPPORTED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// `OPEN_CLIPPER_VISION_BACKEND=ort` skips WinML, to exercise the Windows 10
/// path on Windows 11.
fn force_ort() -> bool {
    std::env::var("OPEN_CLIPPER_VISION_BACKEND")
        .is_ok_and(|value| value.eq_ignore_ascii_case("ort"))
}

/// OS WinML first (unchanged Windows 11 path), bundled ORT when WinML cannot
/// create a session for the model.
pub enum NativeVisionModel {
    WinMl(WinMlModel),
    Ort(OrtVisionModel),
}

impl NativeVisionModel {
    #[allow(clippy::too_many_arguments)]
    pub fn create_into(
        kind: VisionModel,
        path: &Path,
        fp16_path: Option<&Path>,
        input_name: &str,
        output_names: &[&str],
        first_shape: &[i64],
        first_input: &[f32],
        first_outputs: &mut Vec<Vec<f32>>,
    ) -> Result<Self, NativeVisionError> {
        let skip_winml = force_ort()
            || winml_unsupported()
                .lock()
                .is_ok_and(|unsupported| unsupported.contains(&kind));
        let winml_error = if skip_winml {
            None
        } else {
            match WinMlModel::create_into(
                kind,
                path,
                fp16_path,
                input_name,
                output_names,
                first_shape,
                first_input,
                first_outputs,
            ) {
                Ok(model) => return Ok(Self::WinMl(model)),
                Err(error) => {
                    log::warn!("WinML cannot run {kind:?}, falling back to ORT: {error}");
                    if let Ok(mut unsupported) = winml_unsupported().lock() {
                        unsupported.insert(kind);
                    }
                    Some(error)
                }
            }
        };

        let created =
            OrtVisionModel::create(path, input_name, output_names).and_then(|mut model| {
                model.evaluate_into(first_shape, first_input, first_outputs)?;
                Ok(model)
            });
        match created {
            Ok(model) => {
                log::info!("Vision {kind:?} running on ORT device={:?}", model.device());
                Ok(Self::Ort(model))
            }
            Err(error) => {
                log::error!("ORT fallback failed for {kind:?}: {error}");
                // Surface the original WinML failure; ORT is only a fallback.
                Err(winml_error.unwrap_or(error))
            }
        }
    }

    pub fn evaluate_into(
        &mut self,
        shape: &[i64],
        input: &[f32],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        match self {
            Self::WinMl(model) => model.evaluate_into(shape, input, output),
            Self::Ort(model) => model.evaluate_into(shape, input, output),
        }
    }

    pub fn device(&self) -> NativeVisionDevice {
        match self {
            Self::WinMl(model) => model.device(),
            Self::Ort(model) => model.device(),
        }
    }
}
