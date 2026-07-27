use windows::core::{Interface, HSTRING};
use windows::AI::MachineLearning::{LearningModelBinding, LearningModelSession, TensorFloat};
use windows_collections::IIterable;

use super::super::error_util::winml_error;
use super::super::types::NativeVisionError;
use crate::video::smart_crop::diagnostics;

struct OutputSlot {
    name: HSTRING,
    shape: Vec<i64>,
    tensor: TensorFloat,
}

impl Drop for OutputSlot {
    fn drop(&mut self) {
        if let Err(error) = self.tensor.Close() {
            diagnostics::append_critical(
                "winml-cleanup",
                &format!(
                    "output tensor close failed name={} error={error}",
                    self.name
                ),
            );
        }
    }
}

pub(super) struct EvaluationContext {
    binding: LearningModelBinding,
    outputs: Vec<OutputSlot>,
    generation: usize,
}

impl EvaluationContext {
    pub(super) fn new(
        session: &LearningModelSession,
        output_names: &[HSTRING],
        output_shapes: &[Vec<i64>],
        generation: usize,
    ) -> Result<Self, NativeVisionError> {
        if output_names.len() != output_shapes.len() {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!(
                    "WinML output metadata mismatch: {} names for {} shapes",
                    output_names.len(),
                    output_shapes.len()
                ),
                true,
            ));
        }
        let binding = LearningModelBinding::CreateFromSession(session).map_err(|error| {
            winml_error(
                "evaluation_failed",
                "Could not create reusable WinML binding",
                error,
            )
        })?;
        let mut outputs = Vec::with_capacity(output_names.len());
        for (name, shape) in output_names.iter().zip(output_shapes) {
            let iterable = IIterable::<i64>::from(shape.clone());
            let tensor = TensorFloat::Create2(&iterable).map_err(|error| {
                winml_error(
                    "evaluation_failed",
                    &format!("Could not allocate reusable output tensor {name}"),
                    error,
                )
            })?;
            outputs.push(OutputSlot {
                name: name.clone(),
                shape: shape.clone(),
                tensor,
            });
        }
        Ok(Self {
            binding,
            outputs,
            generation,
        })
    }

    pub(super) fn generation(&self) -> usize {
        self.generation
    }

    pub(super) fn output_shapes(&self) -> impl Iterator<Item = &[i64]> {
        self.outputs.iter().map(|slot| slot.shape.as_slice())
    }

    pub(super) fn evaluate_into(
        &mut self,
        session: &LearningModelSession,
        inputs: &[(&HSTRING, &[i64], &[f32])],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        clear_binding(&self.binding, "before reusable evaluation")?;
        let mut input_tensors = Vec::with_capacity(inputs.len());
        let outcome = (|| {
            for slot in &self.outputs {
                self.binding
                    .Bind(&slot.name, &slot.tensor)
                    .map_err(|error| {
                        winml_error(
                            "evaluation_failed",
                            &format!("Could not bind reusable output {}", slot.name),
                            error,
                        )
                    })?;
            }
            for (name, shape, data) in inputs {
                let tensor = TensorFloat::CreateFromShapeArrayAndDataArray(shape, data).map_err(
                    |error| {
                        winml_error(
                            "tensor_contract_mismatch",
                            &format!("Could not create input tensor {name}"),
                            error,
                        )
                    },
                )?;
                input_tensors.push(tensor);
                self.binding
                    .Bind(name, input_tensors.last().expect("just pushed"))
                    .map_err(|error| {
                        winml_error(
                            "tensor_contract_mismatch",
                            &format!("Could not bind input tensor {name}"),
                            error,
                        )
                    })?;
            }
            let result = session
                .Evaluate(&self.binding, &HSTRING::new())
                .map_err(|error| {
                    winml_error("evaluation_failed", "WinML evaluation failed", error)
                })?;
            ensure_succeeded(&result)?;
            output.resize_with(self.outputs.len(), Vec::new);
            output.truncate(self.outputs.len());
            for (slot, destination) in self.outputs.iter().zip(output.iter_mut()) {
                copy_tensor_into(&slot.tensor, &slot.name, destination)?;
            }
            Ok(())
        })();

        let clear_result = clear_binding(&self.binding, "after reusable evaluation");
        close_tensors(&mut input_tensors, "input");
        match (outcome, clear_result) {
            (Err(error), _) => Err(error),
            (Ok(()), Err(error)) => Err(error),
            (Ok(()), Ok(())) => Ok(()),
        }
    }

    pub(super) fn close(&mut self) {
        if let Err(error) = self.binding.Clear() {
            diagnostics::append_critical(
                "winml-cleanup",
                &format!("binding clear failed during context close: {error}"),
            );
        }
        self.outputs.clear();
    }
}

impl Drop for EvaluationContext {
    fn drop(&mut self) {
        self.close();
    }
}

pub(super) fn evaluate_unbound_into(
    session: &LearningModelSession,
    inputs: &[(&HSTRING, &[i64], &[f32])],
    output_names: &[HSTRING],
    output: &mut Vec<Vec<f32>>,
) -> Result<Vec<Vec<i64>>, NativeVisionError> {
    let binding = LearningModelBinding::CreateFromSession(session).map_err(|error| {
        winml_error("evaluation_failed", "Could not create WinML binding", error)
    })?;
    let mut input_tensors = Vec::with_capacity(inputs.len());
    let mut output_tensors = Vec::with_capacity(output_names.len());

    let outcome = (|| {
        for (name, shape, data) in inputs {
            let tensor =
                TensorFloat::CreateFromShapeArrayAndDataArray(shape, data).map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Could not create input tensor {name}"),
                        error,
                    )
                })?;
            input_tensors.push(tensor);
            binding
                .Bind(name, input_tensors.last().expect("just pushed"))
                .map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Could not bind input tensor {name}"),
                        error,
                    )
                })?;
        }
        let result = session
            .Evaluate(&binding, &HSTRING::new())
            .map_err(|error| winml_error("evaluation_failed", "WinML evaluation failed", error))?;
        ensure_succeeded(&result)?;
        let outputs = result.Outputs().map_err(|error| {
            winml_error("evaluation_failed", "Could not read WinML outputs", error)
        })?;
        output.resize_with(output_names.len(), Vec::new);
        output.truncate(output_names.len());
        let mut shapes = Vec::with_capacity(output_names.len());
        for (name, destination) in output_names.iter().zip(output.iter_mut()) {
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
            output_tensors.push(tensor);
            let tensor = output_tensors.last().expect("just pushed");
            shapes.push(tensor_shape(tensor, name)?);
            copy_tensor_into(tensor, name, destination)?;
        }
        Ok(shapes)
    })();

    let clear_result = clear_binding(&binding, "after temporary evaluation");
    close_tensors(&mut input_tensors, "input");
    close_tensors(&mut output_tensors, "temporary output");
    match (outcome, clear_result) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Ok(shapes), Ok(())) => Ok(shapes),
    }
}

fn ensure_succeeded(
    result: &windows::AI::MachineLearning::LearningModelEvaluationResult,
) -> Result<(), NativeVisionError> {
    if result.Succeeded().unwrap_or(false) {
        return Ok(());
    }
    Err(NativeVisionError::new(
        "evaluation_failed",
        format!("WinML status {}", result.ErrorStatus().unwrap_or(-1)),
        true,
    ))
}

fn tensor_shape(tensor: &TensorFloat, name: &HSTRING) -> Result<Vec<i64>, NativeVisionError> {
    let view = tensor.Shape().map_err(|error| {
        winml_error(
            "output_mapping_failed",
            &format!("Cannot read shape of output {name}"),
            error,
        )
    })?;
    let mut shape = vec![0i64; view.Size().unwrap_or(0) as usize];
    let copied = view.GetMany(0, &mut shape).map_err(|error| {
        winml_error(
            "output_mapping_failed",
            &format!("Cannot copy shape of output {name}"),
            error,
        )
    })?;
    if copied as usize != shape.len() {
        return Err(NativeVisionError::new(
            "output_mapping_failed",
            format!(
                "Output {name} shape copy was incomplete: {copied}/{}",
                shape.len()
            ),
            true,
        ));
    }
    Ok(shape)
}

fn copy_tensor_into(
    tensor: &TensorFloat,
    name: &HSTRING,
    destination: &mut Vec<f32>,
) -> Result<(), NativeVisionError> {
    let view = tensor.GetAsVectorView().map_err(|error| {
        winml_error(
            "output_mapping_failed",
            &format!("Cannot map output {name}"),
            error,
        )
    })?;
    let size = view.Size().unwrap_or(0) as usize;
    destination.resize(size, 0.0);
    let copied = view.GetMany(0, destination).map_err(|error| {
        winml_error(
            "output_mapping_failed",
            &format!("Cannot copy output {name}"),
            error,
        )
    })?;
    if copied as usize != size {
        return Err(NativeVisionError::new(
            "output_mapping_failed",
            format!("Output {name} copy was incomplete: {copied}/{size}"),
            true,
        ));
    }
    Ok(())
}

fn clear_binding(binding: &LearningModelBinding, context: &str) -> Result<(), NativeVisionError> {
    binding.Clear().map_err(|error| {
        winml_error(
            "evaluation_failed",
            &format!("Could not clear WinML binding {context}"),
            error,
        )
    })
}

fn close_tensors(tensors: &mut Vec<TensorFloat>, kind: &str) {
    for tensor in tensors.drain(..) {
        if let Err(error) = tensor.Close() {
            diagnostics::append_critical(
                "winml-cleanup",
                &format!("{kind} tensor close failed: {error}"),
            );
        }
    }
}
