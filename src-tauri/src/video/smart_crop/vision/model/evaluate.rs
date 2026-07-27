use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use windows::core::HSTRING;
use windows::AI::MachineLearning::LearningModelSession;

use super::super::device_cache::device_cache;
use super::super::error_util::{is_recoverable_directml_error, winml_error};
use super::super::session::{load_model, make_bound_session};
use super::super::types::{
    ModelPrecision, NativeVisionDevice, NativeVisionError, SessionConfig, BATCH_BOUND,
};
use super::context::{evaluate_unbound_into, EvaluationContext};
use super::memory_guard;
use super::WinMlModel;
use crate::video::smart_crop::diagnostics;

static DIRECTML_EVALUATION_GATE: OnceLock<Mutex<()>> = OnceLock::new();

impl WinMlModel {
    pub(in crate::video::smart_crop::vision) fn evaluate_session(
        session: &LearningModelSession,
        input_name: &HSTRING,
        output_names: &[HSTRING],
        shape: &[i64],
        input: &[f32],
        trace: &str,
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        Self::evaluate_session_named(session, &[(input_name, shape, input)], output_names, trace)
    }

    pub(super) fn evaluate_session_named(
        session: &LearningModelSession,
        inputs: &[(&HSTRING, &[i64], &[f32])],
        output_names: &[HSTRING],
        trace: &str,
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let started = Instant::now();
        let mut output = Vec::new();
        let shapes = evaluate_unbound_into(session, inputs, output_names, &mut output)?;
        diagnostics::append(
            "winml-call",
            &format!(
                "trace={trace} phase=temporary-complete elapsed_ms={} output_lengths={:?} output_shapes={shapes:?} resources={}",
                started.elapsed().as_millis(),
                output.iter().map(Vec::len).collect::<Vec<_>>(),
                diagnostics::resource_snapshot(),
            ),
        );
        Ok(output)
    }

    pub fn evaluate(
        &mut self,
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let mut output = Vec::new();
        self.evaluate_into(shape, input, &mut output)?;
        Ok(output)
    }

    pub fn evaluate_into(
        &mut self,
        shape: &[i64],
        input: &[f32],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        let batch = shape.first().copied().unwrap_or(1) as usize;
        self.with_directml_recovery(batch, |model| {
            model.evaluate_once_into(shape, input, output)
        })
    }

    pub fn evaluate_named(
        &mut self,
        inputs: &[(&str, &[i64], &[f32])],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let mut output = Vec::new();
        self.evaluate_named_into(inputs, &mut output)?;
        Ok(output)
    }

    pub fn evaluate_named_into(
        &mut self,
        inputs: &[(&str, &[i64], &[f32])],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        let batch = inputs
            .first()
            .and_then(|input| input.1.first())
            .copied()
            .unwrap_or(1) as usize;
        if batch != 1 && batch != BATCH_BOUND {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("Unsupported batch size {batch}"),
                true,
            ));
        }
        let names = inputs
            .iter()
            .map(|input| HSTRING::from(input.0))
            .collect::<Vec<_>>();
        let bound = inputs
            .iter()
            .enumerate()
            .map(|(index, input)| (&names[index], input.1, input.2))
            .collect::<Vec<_>>();
        self.with_directml_recovery(batch, |model| {
            model.evaluate_named_once_into(batch, &bound, output)
        })
    }

    fn evaluate_named_once_into(
        &mut self,
        batch: usize,
        inputs: &[(&HSTRING, &[i64], &[f32])],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        self.ensure_single_session(batch)?;
        let started = Instant::now();
        let trace = self.trace_context(batch);
        let verbose = self.evaluation_count < 8 || (self.evaluation_count + 1) % 64 == 0;
        if verbose {
            diagnostics::append(
                "winml-call",
                &format!(
                    "phase=prepare {trace} input_elements={:?} output_capacities={:?} resources={}",
                    inputs
                        .iter()
                        .map(|(_, _, input)| input.len())
                        .collect::<Vec<_>>(),
                    output.iter().map(Vec::capacity).collect::<Vec<_>>(),
                    diagnostics::resource_snapshot(),
                ),
            );
        }

        let generation = self.session_generation;
        let outcome = if batch == 1 {
            let session = self.single_session.as_ref().expect("created above");
            Self::evaluate_cached_into(
                session,
                &mut self.single_context,
                generation,
                inputs,
                &self.output_names,
                output,
            )
        } else {
            let session = &self.session.as_ref().expect("session initialized").value;
            Self::evaluate_cached_into(
                session,
                &mut self.batch_context,
                generation,
                inputs,
                &self.output_names,
                output,
            )
        };

        if verbose || outcome.is_err() {
            let context = if batch == 1 {
                self.single_context.as_ref()
            } else {
                self.batch_context.as_ref()
            };
            let context_shapes = context
                .map(|context| {
                    context
                        .output_shapes()
                        .map(|shape| shape.to_vec())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            diagnostics::append(
                "winml-call",
                &format!(
                    "phase={} {trace} elapsed_ms={} output_lengths={:?} output_capacities={:?} reusable_context={} context_generation={:?} output_shapes={context_shapes:?} resources={}",
                    if outcome.is_ok() { "complete" } else { "failed" },
                    started.elapsed().as_millis(),
                    output.iter().map(Vec::len).collect::<Vec<_>>(),
                    output.iter().map(Vec::capacity).collect::<Vec<_>>(),
                    context.is_some(),
                    context.map(EvaluationContext::generation),
                    diagnostics::resource_snapshot(),
                ),
            );
        }
        outcome
    }

    fn evaluate_once_into(
        &mut self,
        shape: &[i64],
        input: &[f32],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        let batch = shape.first().copied().unwrap_or(1) as usize;
        if batch != 1 && batch != BATCH_BOUND {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("Unsupported batch size {batch}"),
                true,
            ));
        }
        let input_name = self.input_name.clone();
        self.evaluate_named_once_into(batch, &[(&input_name, shape, input)], output)
    }

    #[allow(clippy::too_many_arguments)]
    fn evaluate_cached_into(
        session: &LearningModelSession,
        context: &mut Option<EvaluationContext>,
        generation: usize,
        inputs: &[(&HSTRING, &[i64], &[f32])],
        output_names: &[HSTRING],
        output: &mut Vec<Vec<f32>>,
    ) -> Result<(), NativeVisionError> {
        if context
            .as_ref()
            .is_some_and(|context| context.generation() != generation)
        {
            context.take();
        }
        if let Some(context) = context.as_mut() {
            return context.evaluate_into(session, inputs, output);
        }

        let output_shapes = evaluate_unbound_into(session, inputs, output_names, output)?;
        let created = EvaluationContext::new(session, output_names, &output_shapes, generation)?;
        diagnostics::append(
            "winml-context",
            &format!(
                "created generation={generation} outputs={} shapes={output_shapes:?}",
                output_names.len()
            ),
        );
        *context = Some(created);
        memory_guard::reset(&format!(
            "reusable-context-created generation={generation} outputs={}",
            output_names.len()
        ));
        Ok(())
    }

    fn ensure_single_session(&mut self, batch: usize) -> Result<(), NativeVisionError> {
        if batch != 1 || self.single_session.is_some() {
            return Ok(());
        }
        let config = self.config();
        let device = Self::device_for(config)?;
        let session = make_bound_session(self.model_ref(), &device, 1).map_err(|error| {
            winml_error(
                Self::error_code(config.device),
                "WinML single-frame session creation failed",
                error,
            )
        })?;
        self.single_session = Some(session);
        self.single_context.take();
        if config.device == NativeVisionDevice::DirectXHighPerformance {
            memory_guard::reset(&format!(
                "single-session-created kind={:?} generation={}",
                self.kind, self.session_generation
            ));
        }
        Ok(())
    }

    fn with_directml_recovery<T>(
        &mut self,
        batch: usize,
        mut evaluate: impl FnMut(&mut Self) -> Result<T, NativeVisionError>,
    ) -> Result<T, NativeVisionError> {
        if self.device() != NativeVisionDevice::DirectXHighPerformance {
            let value = evaluate(self)?;
            self.evaluation_count += 1;
            return Ok(value);
        }

        let gate = DIRECTML_EVALUATION_GATE.get_or_init(|| Mutex::new(()));
        let gate_started = Instant::now();
        let guard = gate.lock().map_err(|_| {
            NativeVisionError::new(
                "evaluation_failed",
                "DirectML evaluation gate was poisoned",
                true,
            )
        })?;
        let waited_ms = gate_started.elapsed().as_millis();
        if waited_ms > 500 {
            diagnostics::append(
                "directml-gate",
                &format!(
                    "long wait {} waited_ms={waited_ms}",
                    self.trace_context(batch)
                ),
            );
        }

        if memory_guard::preflight() {
            self.switch_to_cpu()?;
            drop(guard);
            self.ensure_memory_available()?;
            let value = evaluate(self)?;
            self.evaluation_count += 1;
            return Ok(value);
        }

        match evaluate(self) {
            Ok(value) => {
                self.evaluation_count += 1;
                let trace = self.trace_context(batch);
                if memory_guard::record_after_evaluation(&trace) {
                    self.switch_to_cpu()?;
                    self.ensure_memory_available()?;
                }
                return Ok(value);
            }
            Err(error) if !is_recoverable_directml_error(&error) => return Err(error),
            Err(error) => self.log_recovery("directml-failed", batch, &error),
        }

        match self.rebuild_current_sessions() {
            Ok(()) => match evaluate(self) {
                Ok(value) => {
                    self.evaluation_count += 1;
                    diagnostics::append_critical(
                        "directml",
                        &format!(
                            "recovery succeeded kind={:?} batch={batch} generation={} evaluation={}",
                            self.kind, self.session_generation, self.evaluation_count
                        ),
                    );
                    return Ok(value);
                }
                Err(error) if !is_recoverable_directml_error(&error) => return Err(error),
                Err(error) => self.log_recovery("directml-retry-failed", batch, &error),
            },
            Err(error) => self.log_recovery("directml-rebuild-failed", batch, &error),
        }

        self.switch_to_cpu()?;
        drop(guard);
        self.ensure_memory_available()?;
        let value = evaluate(self)?;
        self.evaluation_count += 1;
        diagnostics::append_critical(
            "directml",
            &format!(
                "cpu fallback succeeded kind={:?} batch={batch} generation={} evaluation={}",
                self.kind, self.session_generation, self.evaluation_count
            ),
        );
        Ok(value)
    }

    fn rebuild_current_sessions(&mut self) -> Result<(), NativeVisionError> {
        let config = self.config();
        self.release_sessions();
        let session = Self::make_session(self.model_ref(), config)?;
        self.session = Some(session);
        self.session_generation += 1;
        memory_guard::reset(&format!(
            "session-rebuilt kind={:?} generation={}",
            self.kind, self.session_generation
        ));
        diagnostics::append_critical(
            "directml",
            &format!(
                "session rebuilt kind={:?} config={config:?} generation={} model={}",
                self.kind,
                self.session_generation,
                self.fp32_path.display()
            ),
        );
        Ok(())
    }

    fn switch_to_cpu(&mut self) -> Result<(), NativeVisionError> {
        self.release_sessions();
        if let Some(model) = self.model.take() {
            let _ = model.Close();
        }
        let model = load_model(&self.fp32_path)?;
        let config = SessionConfig {
            device: NativeVisionDevice::Cpu,
            precision: ModelPrecision::Float32,
        };
        let session = Self::make_session(&model, config)?;
        self.model = Some(model);
        self.session = Some(session);
        self.session_generation += 1;
        if let Ok(mut cache) = device_cache().lock() {
            cache.insert(self.kind, config);
        }
        diagnostics::append_critical(
            "directml",
            &format!(
                "switched to quality-preserving fp32 cpu fallback kind={:?} generation={} model={} resources={}",
                self.kind,
                self.session_generation,
                self.fp32_path.display(),
                diagnostics::resource_snapshot(),
            ),
        );
        Ok(())
    }

    fn release_sessions(&mut self) {
        self.batch_context.take();
        self.single_context.take();
        if let Some(session) = self.session.take() {
            session.close();
            drop(session);
        }
        if let Some(single) = self.single_session.take() {
            let _ = single.Close();
            drop(single);
        }
    }

    fn log_recovery(&self, event: &str, batch: usize, error: &NativeVisionError) {
        diagnostics::append_critical(
            "directml",
            &format!(
                "{event} kind={:?} config={:?} batch={batch} generation={} evaluation={} code={} message={} resources={}",
                self.kind,
                self.session.as_ref().map(|session| session.config),
                self.session_generation,
                self.evaluation_count + 1,
                error.code,
                error.message,
                diagnostics::resource_snapshot(),
            ),
        );
    }

    fn ensure_memory_available(&self) -> Result<(), NativeVisionError> {
        if !memory_guard::allocation_is_unsafe() {
            return Ok(());
        }
        let resources = diagnostics::resource_snapshot();
        diagnostics::append_critical(
            "winml-memory",
            &format!("controlled stop after DirectML release resources={resources}"),
        );
        Err(NativeVisionError::new(
            "memory_pressure",
            format!(
                "Not enough memory to continue safely after releasing DirectML resources ({resources})"
            ),
            true,
        ))
    }

    fn model_ref(&self) -> &windows::AI::MachineLearning::LearningModel {
        self.model.as_ref().expect("WinML model is initialized")
    }

    fn session_ref(&self) -> &super::super::session::Session {
        self.session.as_ref().expect("WinML session is initialized")
    }

    fn config(&self) -> SessionConfig {
        self.session_ref().config
    }

    fn trace_context(&self, batch: usize) -> String {
        format!(
            "kind={:?} config={:?} batch={batch} generation={} evaluation={}",
            self.kind,
            self.session.as_ref().map(|session| session.config),
            self.session_generation,
            self.evaluation_count + 1,
        )
    }

    pub fn device(&self) -> NativeVisionDevice {
        self.config().device
    }
}

#[cfg(all(test, windows))]
mod windows_soak_tests {
    use super::*;
    use crate::video::smart_crop::vision::types::VisionModel;

    fn assert_outputs_stable(expected: &[Vec<f32>], actual: &[Vec<f32>]) {
        assert_eq!(expected.len(), actual.len());
        let mut max_delta = 0.0f32;
        for (expected, actual) in expected.iter().zip(actual) {
            assert_eq!(expected.len(), actual.len());
            for (&expected, &actual) in expected.iter().zip(actual) {
                max_delta = max_delta.max((expected - actual).abs());
            }
        }
        assert!(
            max_delta <= 1e-5,
            "reused output changed inference values; max delta={max_delta}"
        );
    }

    #[test]
    #[ignore = "requires bundled models and performs a long DirectML soak"]
    fn directml_face_outputs_and_private_commit_reach_a_plateau() {
        let model_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/clipper-vision/scrfd_10g_bnkps.onnx");
        let fp16_path = model_path.with_extension("fp16.onnx");
        let shape = [1, 3, 640, 640];
        let input = vec![-127.5 / 128.0; 3 * 640 * 640];
        let mut output = Vec::with_capacity(9);
        let mut model = WinMlModel::create_into(
            VisionModel::Face,
            &model_path,
            Some(&fp16_path),
            "input.1",
            &[
                "448", "471", "494", "451", "474", "497", "454", "477", "500",
            ],
            &shape,
            &input,
            &mut output,
        )
        .expect("create SCRFD model");
        if model.device() != NativeVisionDevice::DirectXHighPerformance {
            return;
        }
        for _ in 0..16 {
            model
                .evaluate_into(&shape, &input, &mut output)
                .expect("warm DirectML evaluation");
        }
        let baseline = diagnostics::resource_counters().expect("Windows resource counters");
        let pointers = output.iter().map(Vec::as_ptr).collect::<Vec<_>>();
        let expected_output = output.clone();
        for _ in 0..1_000 {
            model
                .evaluate_into(&shape, &input, &mut output)
                .expect("DirectML soak evaluation");
        }
        let final_snapshot = diagnostics::resource_counters().expect("Windows resource counters");
        assert_eq!(model.device(), NativeVisionDevice::DirectXHighPerformance);
        assert_eq!(pointers, output.iter().map(Vec::as_ptr).collect::<Vec<_>>());
        assert_outputs_stable(&expected_output, &output);
        assert!(
            final_snapshot.private_commit_mib <= baseline.private_commit_mib + 512,
            "private commit did not plateau: baseline={} final={}",
            baseline.private_commit_mib,
            final_snapshot.private_commit_mib
        );
    }

    #[test]
    #[ignore = "requires bundled models and performs a long DirectML soak"]
    fn directml_yolox_batch_outputs_and_private_commit_reach_a_plateau() {
        let model_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/clipper-vision/yolox_s.onnx");
        let fp16_path = model_path.with_extension("fp16.onnx");
        let shape = [8, 3, 640, 640];
        let input = vec![114.0; 8 * 3 * 640 * 640];
        let mut output = Vec::with_capacity(1);
        let mut model = WinMlModel::create_into(
            VisionModel::YoloX,
            &model_path,
            Some(&fp16_path),
            "images",
            &["output"],
            &shape,
            &input,
            &mut output,
        )
        .expect("create YOLOX model");
        if model.device() != NativeVisionDevice::DirectXHighPerformance {
            return;
        }
        for _ in 0..8 {
            model
                .evaluate_into(&shape, &input, &mut output)
                .expect("warm DirectML evaluation");
        }
        let baseline = diagnostics::resource_counters().expect("Windows resource counters");
        let output_pointer = output[0].as_ptr();
        let expected_output = output.clone();
        for _ in 0..256 {
            model
                .evaluate_into(&shape, &input, &mut output)
                .expect("DirectML soak evaluation");
        }
        let final_snapshot = diagnostics::resource_counters().expect("Windows resource counters");
        assert_eq!(model.device(), NativeVisionDevice::DirectXHighPerformance);
        assert_eq!(output_pointer, output[0].as_ptr());
        assert_outputs_stable(&expected_output, &output);
        assert!(
            final_snapshot.private_commit_mib <= baseline.private_commit_mib + 512,
            "private commit did not plateau: baseline={} final={}",
            baseline.private_commit_mib,
            final_snapshot.private_commit_mib
        );
    }

    #[test]
    #[ignore = "requires bundled models and performs a long DirectML soak"]
    fn directml_pose_outputs_and_private_commit_reach_a_plateau() {
        let model_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/clipper-vision/movenet_multipose_lightning.onnx");
        let shape = [1, 256, 256, 3];
        let input = vec![0.0; 256 * 256 * 3];
        let mut output = Vec::with_capacity(1);
        let mut model = WinMlModel::create_into(
            VisionModel::Pose,
            &model_path,
            None,
            "input",
            &["output_0"],
            &shape,
            &input,
            &mut output,
        )
        .expect("create MoveNet model");
        if model.device() != NativeVisionDevice::DirectXHighPerformance {
            return;
        }
        for _ in 0..8 {
            model
                .evaluate_into(&shape, &input, &mut output)
                .expect("warm DirectML evaluation");
        }
        let baseline = diagnostics::resource_counters().expect("Windows resource counters");
        let output_pointer = output[0].as_ptr();
        let expected_output = output.clone();
        for _ in 0..1_000 {
            model
                .evaluate_into(&shape, &input, &mut output)
                .expect("DirectML soak evaluation");
        }
        let final_snapshot = diagnostics::resource_counters().expect("Windows resource counters");
        assert_eq!(model.device(), NativeVisionDevice::DirectXHighPerformance);
        assert_eq!(output_pointer, output[0].as_ptr());
        assert_outputs_stable(&expected_output, &output);
        assert!(
            final_snapshot.private_commit_mib <= baseline.private_commit_mib + 512,
            "private commit did not plateau: baseline={} final={}",
            baseline.private_commit_mib,
            final_snapshot.private_commit_mib
        );
    }

    #[test]
    #[ignore = "requires bundled models and performs a mixed DirectML pipeline soak"]
    fn directml_mixed_pipeline_stays_on_gpu_and_reaches_a_memory_plateau() {
        let models_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/clipper-vision");

        let face_path = models_root.join("scrfd_10g_bnkps.onnx");
        let face_fp16_path = face_path.with_extension("fp16.onnx");
        let face_batch_shape = [8, 3, 640, 640];
        let face_single_shape = [1, 3, 640, 640];
        let face_batch_input = vec![-127.5 / 128.0; 8 * 3 * 640 * 640];
        let face_single_input = vec![-127.5 / 128.0; 3 * 640 * 640];
        let mut face_output = Vec::with_capacity(9);
        let mut face = WinMlModel::create_into(
            VisionModel::Face,
            &face_path,
            Some(&face_fp16_path),
            "input.1",
            &[
                "448", "471", "494", "451", "474", "497", "454", "477", "500",
            ],
            &face_batch_shape,
            &face_batch_input,
            &mut face_output,
        )
        .expect("create SCRFD model");

        let yolox_path = models_root.join("yolox_s.onnx");
        let yolox_fp16_path = yolox_path.with_extension("fp16.onnx");
        let yolox_batch_shape = [8, 3, 640, 640];
        let yolox_single_shape = [1, 3, 640, 640];
        let yolox_batch_input = vec![114.0; 8 * 3 * 640 * 640];
        let yolox_single_input = vec![114.0; 3 * 640 * 640];
        let mut yolox_output = Vec::with_capacity(1);
        let mut yolox = WinMlModel::create_into(
            VisionModel::YoloX,
            &yolox_path,
            Some(&yolox_fp16_path),
            "images",
            &["output"],
            &yolox_batch_shape,
            &yolox_batch_input,
            &mut yolox_output,
        )
        .expect("create YOLOX model");

        let pose_path = models_root.join("movenet_multipose_lightning.onnx");
        let pose_shape = [1, 256, 256, 3];
        let pose_input = vec![0.0; 256 * 256 * 3];
        let mut pose_output = Vec::with_capacity(1);
        let mut pose = WinMlModel::create_into(
            VisionModel::Pose,
            &pose_path,
            None,
            "input",
            &["output_0"],
            &pose_shape,
            &pose_input,
            &mut pose_output,
        )
        .expect("create MoveNet model");

        if [&face, &yolox, &pose]
            .into_iter()
            .any(|model| model.device() != NativeVisionDevice::DirectXHighPerformance)
        {
            return;
        }

        for _ in 0..64 {
            face.evaluate_into(&face_batch_shape, &face_batch_input, &mut face_output)
                .expect("warm SCRFD batch evaluation");
            yolox
                .evaluate_into(&yolox_batch_shape, &yolox_batch_input, &mut yolox_output)
                .expect("warm YOLOX batch evaluation");
            pose.evaluate_into(&pose_shape, &pose_input, &mut pose_output)
                .expect("warm MoveNet evaluation");
            face.evaluate_into(&face_single_shape, &face_single_input, &mut face_output)
                .expect("warm SCRFD single evaluation");
            yolox
                .evaluate_into(&yolox_single_shape, &yolox_single_input, &mut yolox_output)
                .expect("warm YOLOX single evaluation");
        }

        let baseline = diagnostics::resource_counters().expect("Windows resource counters");
        let face_pointers = face_output.iter().map(Vec::as_ptr).collect::<Vec<_>>();
        let yolox_pointer = yolox_output[0].as_ptr();
        let pose_pointer = pose_output[0].as_ptr();

        for _ in 0..256 {
            face.evaluate_into(&face_batch_shape, &face_batch_input, &mut face_output)
                .expect("mixed SCRFD batch evaluation");
            yolox
                .evaluate_into(&yolox_batch_shape, &yolox_batch_input, &mut yolox_output)
                .expect("mixed YOLOX batch evaluation");
            pose.evaluate_into(&pose_shape, &pose_input, &mut pose_output)
                .expect("mixed MoveNet evaluation");
            face.evaluate_into(&face_single_shape, &face_single_input, &mut face_output)
                .expect("mixed SCRFD single evaluation");
            yolox
                .evaluate_into(&yolox_single_shape, &yolox_single_input, &mut yolox_output)
                .expect("mixed YOLOX single evaluation");
        }

        let final_snapshot = diagnostics::resource_counters().expect("Windows resource counters");
        assert_eq!(face.device(), NativeVisionDevice::DirectXHighPerformance);
        assert_eq!(yolox.device(), NativeVisionDevice::DirectXHighPerformance);
        assert_eq!(pose.device(), NativeVisionDevice::DirectXHighPerformance);
        assert_eq!(
            face_pointers,
            face_output.iter().map(Vec::as_ptr).collect::<Vec<_>>()
        );
        assert_eq!(yolox_pointer, yolox_output[0].as_ptr());
        assert_eq!(pose_pointer, pose_output[0].as_ptr());
        assert!(
            final_snapshot.private_commit_mib <= baseline.private_commit_mib + 512,
            "mixed pipeline private commit did not plateau: baseline={} final={}",
            baseline.private_commit_mib,
            final_snapshot.private_commit_mib
        );
    }
}
