use std::path::Path;
use std::time::Instant;

use windows::core::HSTRING;
use windows::AI::MachineLearning::LearningModel;

use super::super::error_util::winml_error;
use super::super::session::{load_model, make_bound_session};
use super::super::types::{
    ModelPrecision, NativeVisionDevice, NativeVisionError, SessionConfig,
};
use super::WinMlModel;

impl WinMlModel {
    /// Benchmarks fp32-CPU, fp32-DirectX, and (when present) fp16-DirectX
    /// with cheap single-frame sessions and returns the fastest
    /// (model, config); the ranking carries over to the retained batch
    /// session. fp16 parity with fp32 is validated offline by
    /// scripts/models/make_derived_clipper_vision_models.py.
    pub(super) fn calibrate(
        fp32_path: &Path,
        fp16_path: Option<&Path>,
        input_name: &HSTRING,
        output_names: &[HSTRING],
        shape: &[i64],
        input: &[f32],
    ) -> Result<(LearningModel, SessionConfig), NativeVisionError> {
        let benchmark = |session: &windows::AI::MachineLearning::LearningModelSession| -> Result<Vec<u128>, NativeVisionError> {
            for _ in 0..2 {
                Self::evaluate_session(session, input_name, output_names, shape, input)?;
            }
            let mut times = Vec::with_capacity(5);
            for _ in 0..5 {
                let started = Instant::now();
                Self::evaluate_session(session, input_name, output_names, shape, input)?;
                times.push(started.elapsed().as_micros());
            }
            times.sort_unstable();
            Ok(times)
        };
        let try_config = |model: &LearningModel, config: SessionConfig| -> Option<Vec<u128>> {
            let device = Self::device_for(config).ok()?;
            let session = make_bound_session(model, &device, 1).ok()?;
            let times = benchmark(&session).ok();
            let _ = session.Close();
            times
        };

        let fp32_model = load_model(fp32_path)?;
        let cpu_config = SessionConfig {
            device: NativeVisionDevice::Cpu,
            precision: ModelPrecision::Float32,
        };
        let cpu_device = Self::device_for(cpu_config)?;
        let cpu_session = make_bound_session(&fp32_model, &cpu_device, 1).map_err(|error| {
            winml_error("cpu_session_failed", "WinML session creation failed", error)
        })?;
        let cpu_times = benchmark(&cpu_session)?;
        let _ = cpu_session.Close();

        let mut best_model = fp32_model.clone();
        let mut best = (cpu_config, cpu_times);
        let directx_fp32 = SessionConfig {
            device: NativeVisionDevice::DirectXHighPerformance,
            precision: ModelPrecision::Float32,
        };
        if let Some(times) = try_config(&fp32_model, directx_fp32) {
            if times[2] < best.1[2] {
                best = (directx_fp32, times);
            }
        }
        if let Some(fp16_path) = fp16_path {
            if let Ok(fp16_model) = load_model(fp16_path) {
                let directx_fp16 = SessionConfig {
                    device: NativeVisionDevice::DirectXHighPerformance,
                    precision: ModelPrecision::Float16,
                };
                if let Some(times) = try_config(&fp16_model, directx_fp16) {
                    if times[2] < best.1[2] {
                        best = (directx_fp16, times);
                        best_model = fp16_model;
                    }
                }
            }
        }
        Ok((best_model, best.0))
    }
}
