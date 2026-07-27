use std::path::Path;
use std::time::Instant;

use windows::core::HSTRING;
use windows::AI::MachineLearning::LearningModel;

use super::super::error_util::winml_error;
use super::super::session::{load_model, make_bound_session};
use super::super::types::{ModelPrecision, NativeVisionDevice, NativeVisionError, SessionConfig};
use super::WinMlModel;
use crate::video::smart_crop::diagnostics;

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
        diagnostics::append(
            "winml-calibrate",
            &format!(
                "start fp32={} fp16={} shape={shape:?} outputs={:?}",
                fp32_path.display(),
                fp16_path
                    .map(|value| value.display().to_string())
                    .unwrap_or_else(|| "<none>".into()),
                output_names,
            ),
        );
        let benchmark = |session: &windows::AI::MachineLearning::LearningModelSession| -> Result<Vec<u128>, NativeVisionError> {
            for _ in 0..2 {
                Self::evaluate_session(
                    session,
                    input_name,
                    output_names,
                    shape,
                    input,
                    "calibration",
                )?;
            }
            let mut times = Vec::with_capacity(5);
            for _ in 0..5 {
                let started = Instant::now();
                Self::evaluate_session(
                    session,
                    input_name,
                    output_names,
                    shape,
                    input,
                    "calibration",
                )?;
                times.push(started.elapsed().as_micros());
            }
            times.sort_unstable();
            Ok(times)
        };
        let try_config = |model: &LearningModel, config: SessionConfig| -> Option<Vec<u128>> {
            diagnostics::append("winml-calibrate", &format!("trying config={config:?}"));
            let device = Self::device_for(config).ok()?;
            let session = make_bound_session(model, &device, 1).ok()?;
            let times = benchmark(&session).ok();
            let _ = session.Close();
            diagnostics::append(
                "winml-calibrate",
                &format!("config={config:?} times_us={times:?}"),
            );
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
        let cpu_times = benchmark(&cpu_session);
        let _ = cpu_session.Close();
        let cpu_times = cpu_times?;
        diagnostics::append(
            "winml-calibrate",
            &format!("config={cpu_config:?} times_us={cpu_times:?}"),
        );

        let mut best = (cpu_config, cpu_times);
        let mut fp16_winner = None;
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
                        fp16_winner = Some(fp16_model);
                    } else {
                        let _ = fp16_model.Close();
                    }
                } else {
                    let _ = fp16_model.Close();
                }
            }
        }
        diagnostics::append(
            "winml-calibrate",
            &format!("selected config={:?} median_us={}", best.0, best.1[2]),
        );
        if let Some(model) = fp16_winner {
            let _ = fp32_model.Close();
            Ok((model, best.0))
        } else {
            Ok((fp32_model, best.0))
        }
    }
}
