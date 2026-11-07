//! Process-wide ONNX Runtime 1.23 (DirectML) loader for the `ort` crate.
//! `ort::init_from(..).commit()` may run only once, so vocals isolation and
//! the vision fallback share this guard.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

static ORT_INIT: Mutex<bool> = Mutex::new(false);

pub fn ensure_ort_loaded() -> Result<(), String> {
    let mut initialized = ORT_INIT
        .lock()
        .map_err(|_| "ORT init lock poisoned".to_string())?;
    if *initialized {
        return Ok(());
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    // Sherpa stages ORT 1.14 as onnxruntime.dll next to the exe; ort 2.x needs
    // >= 1.17. Prefer a distinctly named 1.23 build (or the third_party tree).
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("OPEN_CLIPPER_ORT_DLL") {
        candidates.push(PathBuf::from(path));
    }
    candidates.push(exe_dir.join("onnxruntime_ort.dll"));
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("third_party")
            .join("onnxruntime-directml")
            .join("1.23.0")
            .join("runtimes")
            .join("win-x64")
            .join("native")
            .join("onnxruntime.dll"),
    );

    let dll = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "onnxruntime_ort.dll not found (third_party/onnxruntime-directml/1.23.0 or next to the exe)"
                .to_string()
        })?;
    log::info!("ORT loaded from {}", dll.display());
    ort::init_from(dll.to_string_lossy().as_ref())
        .map_err(|error| format!("Failed to load ONNX Runtime: {error}"))?
        .commit();
    *initialized = true;
    Ok(())
}
