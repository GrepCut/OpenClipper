use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn verify_clipper_vision_models() {
    let root = Path::new("resources/models/clipper-vision");
    let manifest_path = root.join("manifest.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    let manifest_bytes = fs::read(&manifest_path)
        .unwrap_or_else(|error| panic!("Cannot read {}: {error}", manifest_path.display()));
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .unwrap_or_else(|error| panic!("Invalid {}: {error}", manifest_path.display()));
    let models = manifest["models"]
        .as_object()
        .expect("clipper vision manifest must contain a models object");
    for (name, model) in models {
        let file_name = model["onnxFile"]
            .as_str()
            .unwrap_or_else(|| panic!("{name}: missing onnxFile"));
        let expected = model["onnxSha256"]
            .as_str()
            .unwrap_or_else(|| panic!("{name}: missing onnxSha256"));
        let path = root.join(file_name);
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = fs::read(&path).unwrap_or_else(|error| {
            panic!("Cannot read bundled model {}: {error}", path.display())
        });
        let actual = format!("{:x}", Sha256::digest(bytes));
        assert_eq!(actual, expected, "{name}: bundled ONNX SHA-256 mismatch");
        if let (Some(label_file), Some(label_hash)) =
            (model["labelFile"].as_str(), model["labelSha256"].as_str())
        {
            let label_path = root.join(label_file);
            println!("cargo:rerun-if-changed={}", label_path.display());
            let label_bytes = fs::read(&label_path).unwrap_or_else(|error| {
                panic!(
                    "Cannot read bundled label file {}: {error}",
                    label_path.display()
                )
            });
            assert_eq!(
                format!("{:x}", Sha256::digest(label_bytes)),
                label_hash,
                "{name}: bundled label SHA-256 mismatch"
            );
        }
    }
}

fn verify_sherpa_directml_libs() {
    println!("cargo:rerun-if-env-changed=SHERPA_ONNX_LIB_DIR");

    let lib_dir = match std::env::var("SHERPA_ONNX_LIB_DIR") {
        Ok(path) if !path.trim().is_empty() => Path::new(&path).to_path_buf(),
        _ => {
            println!(
                "cargo:warning=Parakeet uses CPU-only sherpa-onnx prebuilds. \
                 For DirectML on Windows run: npm run sherpa:directml"
            );
            return;
        }
    };

    let marker = lib_dir.join("sherpa-onnx-c-api.lib");
    if marker.is_file() {
        sync_sherpa_directml_dlls(&lib_dir);
        println!(
            "cargo:warning=Parakeet DirectML: using sherpa-onnx libs from {}",
            lib_dir.display()
        );
        return;
    }

    println!(
        "cargo:warning=SHERPA_ONNX_LIB_DIR is set but sherpa-onnx-c-api.lib is missing at {}. \
         Run: npm run sherpa:directml — then cargo clean && npm run tauri:dev.",
        lib_dir.display()
    );
}

/// Cargo links against the custom DirectML import libraries, but Windows loads
/// DLLs from beside the executable. Keep that directory in sync so a stale
/// CPU-only sherpa-onnx.dll cannot silently win at runtime.
fn sync_sherpa_directml_dlls(lib_dir: &Path) {
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    let Some(profile_dir) = Path::new(&out_dir).ancestors().nth(3) else {
        println!(
            "cargo:warning=Cannot locate the Cargo profile directory for DirectML DLL staging"
        );
        return;
    };

    let entries = match fs::read_dir(lib_dir) {
        Ok(entries) => entries,
        Err(error) => {
            println!(
                "cargo:warning=Cannot read DirectML library directory {}: {error}",
                lib_dir.display()
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let source = entry.path();
        let is_dll = source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("dll"));
        if !is_dll {
            continue;
        }
        println!("cargo:rerun-if-changed={}", source.display());
        let destination = profile_dir.join(entry.file_name());
        if let Err(error) = fs::copy(&source, &destination) {
            println!(
                "cargo:warning=Cannot stage DirectML DLL {} to {}: {error}",
                source.display(),
                destination.display()
            );
        }
    }
}

/// Stage ORT 1.23 DirectML as `onnxruntime_ort.dll` so Demucs (`ort` crate) does
/// not pick up sherpa's ORT 1.14 `onnxruntime.dll` beside the exe.
fn sync_ort_directml_dll() {
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    let Some(profile_dir) = Path::new(&out_dir).ancestors().nth(3) else {
        println!(
            "cargo:warning=Cannot locate the Cargo profile directory for ORT 1.23 staging"
        );
        return;
    };

    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("third_party")
        .join("onnxruntime-directml")
        .join("1.23.0")
        .join("runtimes")
        .join("win-x64")
        .join("native")
        .join("onnxruntime.dll");
    println!("cargo:rerun-if-changed={}", source.display());

    if !source.is_file() {
        println!(
            "cargo:warning=Demucs ORT 1.23 missing at {}. \
             Place Microsoft.ML.OnnxRuntime.DirectML 1.23.0 under third_party/onnxruntime-directml.",
            source.display()
        );
        return;
    }

    let destination = profile_dir.join("onnxruntime_ort.dll");
    if let Err(error) = fs::copy(&source, &destination) {
        println!(
            "cargo:warning=Cannot stage ORT 1.23 to {}: {error}",
            destination.display()
        );
    }
}

fn main() {
    verify_clipper_vision_models();
    if cfg!(target_os = "windows") {
        verify_sherpa_directml_libs();
        sync_ort_directml_dll();
        println!(
            "cargo:rustc-link-search=native=C:\\ffmpeg\\vcpkg\\installed\\x64-windows-static\\lib"
        );
        println!("cargo:rustc-link-lib=static=avcodec");
        println!("cargo:rustc-link-lib=static=avdevice");
        println!("cargo:rustc-link-lib=static=avfilter");
        println!("cargo:rustc-link-lib=static=avformat");
        println!("cargo:rustc-link-lib=static=avutil");
        println!("cargo:rustc-link-lib=static=swresample");
        println!("cargo:rustc-link-lib=static=swscale");

        println!("cargo:rustc-link-lib=ole32");
        println!("cargo:rustc-link-lib=oleaut32");
        println!("cargo:rustc-link-lib=strmiids");
        println!("cargo:rustc-link-lib=secur32");
        println!("cargo:rustc-link-lib=ws2_32");
        println!("cargo:rustc-link-lib=bcrypt");
        println!("cargo:rustc-link-lib=user32");
        println!("cargo:rustc-link-lib=mfplat");
        println!("cargo:rustc-link-lib=mfuuid");
        println!("cargo:rustc-link-lib=gdi32");
        println!("cargo:rustc-link-lib=advapi32");
    }
    tauri_build::build()
}
