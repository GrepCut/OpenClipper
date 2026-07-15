//! Protokół `grepcut-models`: serwuje assety modeli ML (MediaPipe, whisper,
//! ONNX itd.) z cache na dysku, pobierając brakujące pliki z CDN przy pierwszym
//! użyciu. Dzięki temu ~290 MB modeli nie jest pakowane do instalatora, a
//! frontend nie potrzebuje żadnych jawnych "ensure/download" — każdy istniejący
//! fetch po prostu działa (pierwszy raz wolniej).
//!
//! Układ: URL `https://grepcut-models.localhost/models/<ścieżka>` →
//! plik `app_data_dir()/models/<ścieżka>`, pobierany z `{CDN_BASE}/models/<ścieżka>`.
//! Skrypt `scripts/generate-model-manifest.mjs` produkuje manifest uploadu na CDN
//! (to samo drzewo ścieżek).

use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager};

use crate::media_protocol::{is_safe_path_segment, serve_file};

const FALLBACK_MODELS_CDN_BASE: &str = "https://models.grepcut.com/v1";

/// Serializuje pobierania — równoległe requesty (np. kilka workerów detekcji
/// twarzy proszących o ten sam .tflite) nie ściągają tego samego pliku
/// wielokrotnie. Serwowanie z cache pozostaje w pełni równoległe.
static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadEvent {
    path: String,
    received: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

fn models_cdn_base() -> String {
    option_env!("GREPCUT_MODELS_CDN_BASE")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(FALLBACK_MODELS_CDN_BASE)
        .trim_end_matches('/')
        .to_string()
}

fn error_body(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.into_bytes())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Ścieżka requestu → (ścieżka lokalna w cache, ścieżka URL na CDN).
/// Wymaga prefiksu `/models/` i sanityzuje każdy segment (bez `..`, separatorów itd.).
fn resolve_paths(app: &AppHandle, request_path: &str) -> Result<(PathBuf, String), String> {
    let mut segments = request_path
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty());
    if segments.next() != Some("models") {
        return Err("model path must start with /models/".to_string());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve data directory: {error}"))?;

    let mut local = data_dir.join("models");
    let mut remote = String::from("/models");
    let mut joined = false;
    for segment in segments {
        if !is_safe_path_segment(segment) {
            return Err("invalid model path segment".to_string());
        }
        local.push(segment);
        remote.push('/');
        remote.push_str(segment);
        joined = true;
    }
    if !joined {
        return Err("missing model file path".to_string());
    }
    Ok((local, remote))
}

/// Pobiera plik z CDN do `<local>.part` i atomowo podmienia na `local`.
/// Emituje eventy `model-download` (throttlowane) dla UI postępu.
pub fn download_model_file_to_cache(
    app: &AppHandle,
    local: &PathBuf,
    remote_path: &str,
) -> Result<(), String> {
    download_to_cache(app, local, remote_path)
}

fn download_to_cache(app: &AppHandle, local: &PathBuf, remote_path: &str) -> Result<(), String> {
    let url = format!("{}{}", models_cdn_base(), remote_path);
    if let Some(parent) = local.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create model cache dir: {e}"))?;
    }

    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let mut response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Model download failed ({url}): {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Model download failed ({url}): HTTP {}",
            response.status()
        ));
    }

    let total = response.content_length();
    let part_path = local.with_extension(format!(
        "{}.part",
        local.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    let mut file =
        std::fs::File::create(&part_path).map_err(|e| format!("Cannot create model file: {e}"))?;

    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];
    let emit = |received: u64, done: bool, error: Option<String>| {
        let _ = app.emit(
            "model-download",
            ModelDownloadEvent {
                path: remote_path.to_string(),
                received,
                total,
                done,
                error,
            },
        );
    };
    emit(0, false, None);

    loop {
        let read = match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = std::fs::remove_file(&part_path);
                let message = format!("Model download interrupted ({url}): {e}");
                emit(received, true, Some(message.clone()));
                return Err(message);
            }
        };
        if let Err(e) = file.write_all(&buffer[..read]) {
            let _ = std::fs::remove_file(&part_path);
            let message = format!("Model write failed: {e}");
            emit(received, true, Some(message.clone()));
            return Err(message);
        }
        received += read as u64;
        // Emituj co ~512 KB, żeby nie zalewać webview eventami.
        if received - last_emit >= 512 * 1024 {
            last_emit = received;
            emit(received, false, None);
        }
    }
    drop(file);

    if let Some(expected) = total {
        if received != expected {
            let _ = std::fs::remove_file(&part_path);
            let message = format!("Model download incomplete ({url}): {received}/{expected} bytes");
            emit(received, true, Some(message.clone()));
            return Err(message);
        }
    }

    std::fs::rename(&part_path, local).map_err(|e| {
        let _ = std::fs::remove_file(&part_path);
        format!("Model cache rename failed: {e}")
    })?;
    emit(received, true, None);
    Ok(())
}

pub fn models_protocol_handler(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, Content-Type")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return error_body(StatusCode::METHOD_NOT_ALLOWED, "method not allowed".into());
    }

    let (local, remote_path) = match resolve_paths(app, request.uri().path()) {
        Ok(paths) => paths,
        Err(message) => return error_body(StatusCode::NOT_FOUND, message),
    };

    if !local.is_file() {
        // Podwójne sprawdzenie pod lockiem: konkurencyjny request mógł już pobrać.
        let _guard = DOWNLOAD_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if !local.is_file() {
            if let Err(message) = download_to_cache(app, &local, &remote_path) {
                log::warn!("grepcut-models: {message}");
                return error_body(StatusCode::BAD_GATEWAY, message);
            }
        }
    }

    serve_file(request, local)
}
