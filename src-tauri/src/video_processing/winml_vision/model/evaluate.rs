use windows::core::{Interface, HSTRING};
use windows::AI::MachineLearning::{
    LearningModelBinding, LearningModelSession, TensorFloat,
};

use super::super::device_cache::device_cache;
use super::super::error_util::{fallback_after_evaluation_failure, winml_error};
use super::super::session::{load_model, make_bound_session};
use super::super::types::{
    BATCH_BOUND, ModelPrecision, NativeVisionDevice, NativeVisionError, SessionConfig,
};
use super::WinMlModel;

impl WinMlModel {
    pub(in crate::video_processing::winml_vision) fn evaluate_session(
        session: &LearningModelSession,
        input_name: &HSTRING,
        output_names: &[HSTRING],
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        Self::evaluate_session_named(session, &[(input_name, shape, input)], output_names)
    }

    pub(super) fn evaluate_session_named(
        session: &LearningModelSession,
        inputs: &[(&HSTRING, &[i64], &[f32])],
        output_names: &[HSTRING],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let binding = LearningModelBinding::CreateFromSession(session).map_err(|error| {
            winml_error("evaluation_failed", "Could not create WinML binding", error)
        })?;
        for (input_name, shape, input) in inputs {
            let tensor = TensorFloat::CreateFromShapeArrayAndDataArray(shape, input).map_err(|error| {
                winml_error(
                    "tensor_contract_mismatch",
                    "Could not create input tensor",
                    error,
                )
            })?;
            binding.Bind(input_name, &tensor).map_err(|error| {
                winml_error(
                    "tensor_contract_mismatch",
                    "Could not bind input tensor",
                    error,
                )
            })?;
        }
        let result = session
            .Evaluate(&binding, &HSTRING::new())
            .map_err(|error| winml_error("evaluation_failed", "WinML evaluation failed", error))?;
        if !result.Succeeded().unwrap_or(false) {
            return Err(NativeVisionError::new(
                "evaluation_failed",
                format!("WinML status {}", result.ErrorStatus().unwrap_or(-1)),
                true,
            ));
        }
        let outputs = result.Outputs().map_err(|error| {
            winml_error("evaluation_failed", "Could not read WinML outputs", error)
        })?;
        output_names
            .iter()
            .map(|name| {
                let inspectable = outputs.Lookup(name).map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Missing output {name}"),
                        error,
                    )
                })?;
                let tensor: TensorFloat = inspectable.cast().map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Output {name} is not float32"),
                        error,
                    )
                })?;
                let view = tensor.GetAsVectorView().map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Cannot map output {name}"),
                        error,
                    )
                })?;
                let mut data = vec![0.0; view.Size().unwrap_or(0) as usize];
                view.GetMany(0, &mut data).map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Cannot copy output {name}"),
                        error,
                    )
                })?;
                Ok(data)
            })
            .collect()
    }

    /// Evaluates a tensor whose leading dimension is 1 or BATCH_BOUND — the
    /// two batch sizes sessions are compiled for.
    pub fn evaluate(
        &mut self,
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        match self.evaluate_once(shape, input) {
            Ok(outputs) => Ok(outputs),
            Err(_)
                if fallback_after_evaluation_failure(self.session.config.device)
                    == Some(NativeVisionDevice::Cpu) =>
            {
                self.session.close();
                if let Some(single) = self.single_session.take() {
                    let _ = single.Close();
                }
                // The failing session may have been running the fp16 variant;
                // the CPU fallback always goes back to the fp32 model.
                if self.session.config.precision == ModelPrecision::Float16 {
                    let _ = self.model.Close();
                    self.model = load_model(&self.fp32_path)?;
                }
                let fallback = SessionConfig {
                    device: NativeVisionDevice::Cpu,
                    precision: ModelPrecision::Float32,
                };
                self.session = Self::make_session(&self.model, fallback)?;
                if let Ok(mut cache) = device_cache().lock() {
                    cache.insert(self.kind, fallback);
                }
                self.evaluate_once(shape, input)
            }
            Err(error) => Err(error),
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn evaluate_named(
        &mut self,
        inputs: &[(&str, &[i64], &[f32])],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let batch = inputs.first().and_then(|input| input.1.first()).copied().unwrap_or(1) as usize;
        if batch != 1 && batch != BATCH_BOUND {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("Unsupported batch size {batch}"),
                true,
            ));
        }
        if batch == 1 && self.single_session.is_none() {
            let device = Self::device_for(self.session.config)?;
            self.single_session = Some(make_bound_session(&self.model, &device, 1).map_err(|error| {
                winml_error(Self::error_code(self.session.config.device), "WinML session creation failed", error)
            })?);
        }
        let names = inputs.iter().map(|input| HSTRING::from(input.0)).collect::<Vec<_>>();
        let bound = inputs.iter().enumerate().map(|(index, input)| (&names[index], input.1, input.2)).collect::<Vec<_>>();
        let session = if batch == 1 {
            self.single_session.as_ref().expect("created above")
        } else {
            &self.session.value
        };
        Self::evaluate_session_named(session, &bound, &self.output_names)
    }

    fn evaluate_once(
        &mut self,
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let bound = shape.first().copied().unwrap_or(1) as usize;
        if bound == BATCH_BOUND {
            return Self::evaluate_session(
                &self.session.value,
                &self.input_name,
                &self.output_names,
                shape,
                input,
            );
        }
        if bound != 1 {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("Unsupported batch size {bound}"),
                true,
            ));
        }
        if self.single_session.is_none() {
            let device = Self::device_for(self.session.config)?;
            let session = make_bound_session(&self.model, &device, 1).map_err(|error| {
                winml_error(
                    Self::error_code(self.session.config.device),
                    "WinML session creation failed",
                    error,
                )
            })?;
            self.single_session = Some(session);
        }
        Self::evaluate_session(
            self.single_session.as_ref().expect("created above"),
            &self.input_name,
            &self.output_names,
            shape,
            input,
        )
    }

    pub fn device(&self) -> NativeVisionDevice {
        self.session.config.device
    }
}
