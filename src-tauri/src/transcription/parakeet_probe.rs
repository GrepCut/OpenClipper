use super::parakeet_provider::ParakeetProvider;
use super::types::TranscriptionError;
use std::path::Path;

pub fn default_thread_count() -> i32 {
    std::thread::available_parallelism()
        .map(|count| count.get().min(8) as i32)
        .unwrap_or(2)
}

/// Load once: try DirectML, fall back to CPU. No throwaway smoke load beforehand.
pub fn load_preferred(
    model_dir: &Path,
    num_threads: i32,
) -> Result<(ParakeetProvider, String), TranscriptionError> {
    match ParakeetProvider::load_with_provider(model_dir, "directml", num_threads) {
        Ok(provider) => {
            log::info!("Parakeet: using DirectML provider");
            Ok((provider, "directml".to_string()))
        }
        Err(error) => {
            log::warn!(
                "Parakeet DirectML load failed ({error}); falling back to CPU. \
                 If you want GPU inference on Windows, build sherpa-onnx with DirectML \
                 (npm run sherpa:directml) and rebuild the app (cargo clean && npm run tauri:dev)."
            );
            let provider = ParakeetProvider::load_with_provider(model_dir, "cpu", num_threads)?;
            Ok((provider, "cpu".to_string()))
        }
    }
}

/// Smoke-test providers (CLI / explicit probe only). Prefer [`load_preferred`] for workers.
pub fn select_provider(model_dir: &Path, num_threads: i32) -> (String, bool) {
    if smoke_provider(model_dir, "directml", num_threads) {
        log::info!("Parakeet: using DirectML provider");
        ("directml".to_string(), true)
    } else {
        log::warn!(
            "Parakeet DirectML probe failed; falling back to CPU. \
             If you want GPU inference on Windows, build sherpa-onnx with DirectML \
             (npm run sherpa:directml) and rebuild the app (cargo clean && npm run tauri:dev)."
        );
        ("cpu".to_string(), false)
    }
}

pub fn smoke_provider(model_dir: &Path, provider: &str, num_threads: i32) -> bool {
    let parakeet = match ParakeetProvider::load_with_provider(model_dir, provider, num_threads) {
        Ok(provider) => provider,
        Err(error) => {
            if provider == "directml" {
                log::debug!("Parakeet DirectML load failed: {error}");
            }
            return false;
        }
    };
    parakeet.smoke_decode(16_000, &vec![0.0f32; 16_000])
}
