use super::types::NativeVisionError;

pub(super) fn winml_error(
    code: &'static str,
    context: &str,
    error: windows::core::Error,
) -> NativeVisionError {
    NativeVisionError::new(code, format!("{context}: {error}"), true)
}

pub(super) fn is_recoverable_directml_error(error: &NativeVisionError) -> bool {
    matches!(
        error.code,
        "evaluation_failed" | "output_mapping_failed" | "directx_unavailable"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directml_runtime_errors_are_recoverable() {
        for code in [
            "evaluation_failed",
            "output_mapping_failed",
            "directx_unavailable",
        ] {
            assert!(is_recoverable_directml_error(&NativeVisionError::new(
                code, "failure", true
            )));
        }
    }

    #[test]
    fn tensor_contract_errors_are_not_recoverable() {
        assert!(!is_recoverable_directml_error(&NativeVisionError::new(
            "tensor_contract_mismatch",
            "wrong output shape",
            true,
        )));
    }
}
