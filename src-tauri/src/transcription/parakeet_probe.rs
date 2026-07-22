use super::parakeet_provider::ParakeetProvider;
use std::path::Path;

pub fn default_thread_count() -> i32 {
    std::thread::available_parallelism()
        .map(|count| count.get().min(8) as i32)
        .unwrap_or(2)
}

pub fn select_provider(model_dir: &Path, num_threads: i32) -> String {
    if smoke_provider(model_dir, "directml", num_threads) {
        log::info!("Parakeet: using DirectML provider");
        "directml".to_string()
    } else {
        log::warn!(
            "Parakeet DirectML probe failed; falling back to CPU. \
             If you want GPU inference on Windows, build sherpa-onnx with DirectML \
             (npm run sherpa:directml) and rebuild the app (cargo clean && npm run tauri:dev)."
        );
        "cpu".to_string()
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
