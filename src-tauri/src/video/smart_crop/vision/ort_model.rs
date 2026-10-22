use std::path::Path;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;

use super::types::{NativeVisionDevice, NativeVisionError};
use crate::infra::ort_runtime::ensure_ort_loaded;

/// Vision session on the bundled ONNX Runtime 1.23 + DirectML. Used only when
/// the OS WinML cannot load a model: Windows 10 (build 19041) ships WinML that
/// accepts ONNX IR <= 5 / opset <= 9, older than every bundled vision model.
pub struct OrtVisionModel {
    session: Session,
    input_name: String,
    output_names: Vec<String>,
    device: NativeVisionDevice,
}

impl OrtVisionModel {
    pub fn create(
        path: &Path,
        input_name: &str,
        output_names: &[&str],
    ) -> Result<Self, NativeVisionError> {
        ensure_ort_loaded()
            .map_err(|message| NativeVisionError::new("model_missing", message, true))?;
        let (session, device) = match Self::build(path, true) {
            Ok(session) => (session, NativeVisionDevice::DirectXHighPerformance),
            Err(error) => {
                log::warn!("Vision ORT DirectML unavailable, falling back to CPU: {error}");
                (Self::build(path, false)?, NativeVisionDevice::Cpu)
            }
        };
        Ok(Self {
            session,
            input_name: input_name.to_owned(),
            output_names: output_names.iter().map(|name| (*name).to_owned()).collect(),
            device,
        })
    }

    fn build(path: &Path, directml: bool) -> Result<Session, NativeVisionError> {
        let session_error = |error: String| {
            NativeVisionError::new("cpu_session_failed", format!("ORT session: {error}"), true)
        };
        let builder = Session::builder()
            .map_err(|error| session_error(error.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|error| session_error(error.to_string()))?;
        let mut builder = if directml {
            builder
                .with_execution_providers([ort::ep::DirectML::default().build().error_on_failure()])
                .map_err(|error| session_error(error.to_string()))?
        } else {
            builder
        };
        builder
            .commit_from_file(path)
            .map_err(|error| session_error(error.to_string()))
    }

    pub fn evaluate_into(
        &mut self,
        shape: &[i64],
        input: &[f32],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        let evaluation_error = |error: ort::Error| {
            NativeVisionError::new(
                "evaluation_failed",
                format!("ORT evaluation failed: {error}"),
                true,
            )
        };
        let tensor = TensorRef::from_array_view((shape, input)).map_err(|error| {
            NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("ORT input tensor: {error}"),
                true,
            )
        })?;
        let outputs = self
            .session
            .run(ort::inputs![self.input_name.as_str() => tensor])
            .map_err(evaluation_error)?;
        output.resize_with(self.output_names.len(), Vec::new);
        output.truncate(self.output_names.len());
        for (name, destination) in self.output_names.iter().zip(output.iter_mut()) {
            let value = outputs.get(name).ok_or_else(|| {
                NativeVisionError::new(
                    "tensor_contract_mismatch",
                    format!("Missing output {name}"),
                    true,
                )
            })?;
            let (_shape, data) = value.try_extract_tensor::<f32>().map_err(|error| {
                NativeVisionError::new(
                    "tensor_contract_mismatch",
                    format!("Output {name} is not float32: {error}"),
                    true,
                )
            })?;
            destination.clear();
            destination.extend_from_slice(data);
        }
        Ok(())
    }

    pub fn device(&self) -> NativeVisionDevice {
        self.device
    }
}
