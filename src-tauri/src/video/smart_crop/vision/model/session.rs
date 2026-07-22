use windows::AI::MachineLearning::{LearningModel, LearningModelDevice, LearningModelDeviceKind};

use super::super::error_util::winml_error;
use super::super::session::{make_bound_session, Session};
use super::super::types::{BATCH_BOUND, NativeVisionDevice, NativeVisionError, SessionConfig};
use super::WinMlModel;

impl WinMlModel {
    pub(super) fn error_code(device: NativeVisionDevice) -> &'static str {
        if device == NativeVisionDevice::Cpu {
            "cpu_session_failed"
        } else {
            "directx_unavailable"
        }
    }

    pub(super) fn device_for(config: SessionConfig) -> Result<LearningModelDevice, NativeVisionError> {
        let kind = match config.device {
            NativeVisionDevice::Cpu => LearningModelDeviceKind::Cpu,
            NativeVisionDevice::DirectXHighPerformance => {
                LearningModelDeviceKind::DirectXHighPerformance
            }
        };
        LearningModelDevice::Create(kind).map_err(|error| {
            winml_error(
                Self::error_code(config.device),
                "WinML device creation failed",
                error,
            )
        })
    }

    pub(in crate::video::smart_crop::vision) fn make_session(
        model: &LearningModel,
        config: SessionConfig,
    ) -> Result<Session, NativeVisionError> {
        let model_device = Self::device_for(config)?;
        let value = make_bound_session(model, &model_device, BATCH_BOUND).map_err(|error| {
            winml_error(
                Self::error_code(config.device),
                "WinML session creation failed",
                error,
            )
        })?;
        Ok(Session { value, config })
    }
}
