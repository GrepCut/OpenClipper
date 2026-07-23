use super::types::{NativeVisionDevice, NativeVisionError};

pub(super) fn winml_error(
    code: &'static str,
    context: &str,
    error: windows::core::Error,
) -> NativeVisionError {
    NativeVisionError::new(code, format!("{context}: {error}"), true)
}

pub(super) fn fallback_after_evaluation_failure(
    device: NativeVisionDevice,
) -> Option<NativeVisionDevice> {
    (device == NativeVisionDevice::DirectXHighPerformance).then_some(NativeVisionDevice::Cpu)
}
