use serde::{Deserialize, Serialize};

/// Fixed batch size every session is compiled for. The bundled models expose
/// a free "batch" dimension; pinning it via OverrideNamedDimension lets
/// WinML precompile a static DirectML graph (free dimensions force a
/// re-plan on every Evaluate, which is dramatically slower). All callers
/// must pad their tensors to this bound.
pub const BATCH_BOUND: usize = 8;

/// ONNX vision models used by the smart-crop pipeline.
/// Planned: active speaker detection (`lr_asd_ava.onnx`) — not wired yet.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum VisionModel {
    Face,
    YoloX,
    Pose,
    TransNet,
    ReId,
    ViNet,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
pub enum NativeVisionDevice {
    #[serde(rename = "directx-high-performance")]
    DirectXHighPerformance,
    #[serde(rename = "cpu")]
    Cpu,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModelPrecision {
    Float32,
    Float16,
}

/// Winning (device, precision) pair from calibration, reused by later sessions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionConfig {
    pub device: NativeVisionDevice,
    pub precision: ModelPrecision,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionError {
    pub code: &'static str,
    pub message: String,
    pub fatal: bool,
}

impl NativeVisionError {
    pub fn new(code: &'static str, message: impl Into<String>, fatal: bool) -> Self {
        Self {
            code,
            message: message.into(),
            fatal,
        }
    }
}

impl std::fmt::Display for NativeVisionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NativeVisionError {}
