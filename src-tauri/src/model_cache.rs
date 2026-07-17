//! Protokół `grepcut-models`: serwuje assety modeli ML z lokalnego cache.
//! Brakujące pliki są pobierane z CDN Open Clipper i weryfikowane względem
//! manifestu SHA-256 wygenerowanego przez `models_automation`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager};

use crate::media_protocol::{is_safe_path_segment, serve_file};

const FALLBACK_MODELS_CDN_BASE: &str = "https://models.openclipper.grepcut.com/v1";

static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());
static MODEL_MANIFEST: Mutex<Option<ModelManifest>> = Mutex::new(None);
static VERIFIED_MODEL_FILES: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

#[derive(Clone, Deserialize)]
struct ModelManifest {
    version: u32,
    files: Vec<ModelManifestFile>,
}

#[derive(Clone, Deserialize)]
struct ModelManifestFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadEvent {
    path: String,
    received: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

enum CacheState {
    VerifiedInMemory,
    VerifiedOnDisk,
    NeedsDownload,
}

fn models_cdn_base() -> String {
    option_env!("OPEN_CLIPPER_MODELS_CDN_BASE")
        .filter(|value| !value.trim().is_empty())
        // Supports existing local build environments during migration.
        .or(option_env!("GREPCUT_MODELS_CDN_BASE"))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(FALLBACK_MODELS_CDN_BASE)
        .trim_end_matches('/')
        .to_string()
}

fn load_model_manifest() -> Result<ModelManifest, String> {
    let mut cached = MODEL_MANIFEST
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Some(manifest) = cached.as_ref() {
        return Ok(manifest.clone());
    }

    let url = format!("{}/model-manifest.json", models_cdn_base());
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|error| format!("Model manifest HTTP client error: {error}"))?;
    let response = client
        .get(&url)
        .send()
        .map_err(|error| format!("Model manifest download failed ({url}): {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Model manifest download failed ({url}): HTTP {}",
            response.status()
        ));
    }
    let manifest: ModelManifest = serde_json::from_reader(response)
        .map_err(|error| format!("Invalid model manifest ({url}): {error}"))?;
    if manifest.version != 1 {
        return Err(format!(
            "Unsupported model manifest version: {}",
            manifest.version
        ));
    }
    *cached = Some(manifest.clone());
    Ok(manifest)
}

fn expected_model(remote_path: &str) -> Result<ModelManifestFile, String> {
    let path = remote_path.trim_start_matches('/');
    load_model_manifest()?
        .files
        .into_iter()
        .find(|file| file.path == path)
        .ok_or_else(|| format!("Model is not published in CDN manifest: {remote_path}"))
}

fn sha256_file(path: &PathBuf) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("Cannot read model cache: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot hash model cache: {error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn file_matches_manifest(path: &PathBuf, expected: &ModelManifestFile) -> Result<bool, String> {
    if !path.is_file()
        || path
            .metadata()
            .map_err(|error| format!("Cannot inspect model cache: {error}"))?
            .len()
            != expected.size
    {
        return Ok(false);
    }
    Ok(sha256_file(path)?.eq_ignore_ascii_case(&expected.sha256))
}

fn verified_files() -> std::sync::MutexGuard<'static, Option<HashSet<PathBuf>>> {
    VERIFIED_MODEL_FILES
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

fn mark_file_verified(path: &PathBuf) {
    verified_files()
        .get_or_insert_with(HashSet::new)
        .insert(path.clone());
}

fn cache_state(path: &PathBuf, expected: &ModelManifestFile) -> Result<CacheState, String> {
    if verified_files()
        .as_ref()
        .is_some_and(|files| files.contains(path))
        && path
            .metadata()
            .map(|metadata| metadata.len() == expected.size)
            .unwrap_or(false)
    {
        return Ok(CacheState::VerifiedInMemory);
    }
    if file_matches_manifest(path, expected)? {
        mark_file_verified(path);
        Ok(CacheState::VerifiedOnDisk)
    } else {
        Ok(CacheState::NeedsDownload)
    }
}

fn error_body(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.into_bytes())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn resolve_paths(app: &AppHandle, request_path: &str) -> Result<(PathBuf, String), String> {
    let mut segments = request_path
        .trim_start_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty());
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

fn download_to_cache(
    app: &AppHandle,
    local: &PathBuf,
    remote_path: &str,
    expected: &ModelManifestFile,
) -> Result<(), String> {
    let url = format!("{}{}", models_cdn_base(), remote_path);
    if let Some(parent) = local.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create model cache dir: {error}"))?;
    }

    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))?;
    let mut response = client
        .get(&url)
        .send()
        .map_err(|error| format!("Model download failed ({url}): {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Model download failed ({url}): HTTP {}",
            response.status()
        ));
    }

    let part_path = local.with_extension(format!(
        "{}.part",
        local
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
    ));
    let mut file = std::fs::File::create(&part_path)
        .map_err(|error| format!("Cannot create model file: {error}"))?;
    let mut received = 0_u64;
    let mut last_emit = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let mut digest = Sha256::new();
    let emit = |received: u64, done: bool, error: Option<String>| {
        let _ = app.emit(
            "model-download",
            ModelDownloadEvent {
                path: remote_path.to_string(),
                received,
                total: Some(expected.size),
                done,
                error,
            },
        );
    };
    emit(0, false, None);

    loop {
        let read = match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) => {
                let _ = std::fs::remove_file(&part_path);
                let message = format!("Model download interrupted ({url}): {error}");
                emit(received, true, Some(message.clone()));
                return Err(message);
            }
        };
        if let Err(error) = file.write_all(&buffer[..read]) {
            let _ = std::fs::remove_file(&part_path);
            let message = format!("Model write failed: {error}");
            emit(received, true, Some(message.clone()));
            return Err(message);
        }
        received += read as u64;
        digest.update(&buffer[..read]);
        if received - last_emit >= 512 * 1024 {
            last_emit = received;
            emit(received, false, None);
        }
    }
    drop(file);

    if received != expected.size {
        let _ = std::fs::remove_file(&part_path);
        let message = format!(
            "Model download incomplete ({url}): {received}/{} bytes",
            expected.size
        );
        emit(received, true, Some(message.clone()));
        return Err(message);
    }
    if !format!("{:x}", digest.finalize()).eq_ignore_ascii_case(&expected.sha256) {
        let _ = std::fs::remove_file(&part_path);
        let message = format!("Model download checksum mismatch ({url})");
        emit(received, true, Some(message.clone()));
        return Err(message);
    }

    std::fs::rename(&part_path, local).map_err(|error| {
        let _ = std::fs::remove_file(&part_path);
        format!("Model cache rename failed: {error}")
    })?;
    mark_file_verified(local);
    emit(received, true, None);
    Ok(())
}

/// Download one manifest-listed model into a caller-owned cache location.
/// Used by the dedicated Parakeet installer as well as the URI protocol.
pub fn download_model_file_to_cache(
    app: &AppHandle,
    local: &PathBuf,
    remote_path: &str,
) -> Result<(), String> {
    let expected = expected_model(remote_path)?;
    match cache_state(local, &expected)? {
        CacheState::VerifiedInMemory | CacheState::VerifiedOnDisk => Ok(()),
        CacheState::NeedsDownload => download_to_cache(app, local, remote_path, &expected),
    }
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

    let _guard = DOWNLOAD_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    match download_model_file_to_cache(app, &local, &remote_path) {
        Ok(()) => {}
        Err(message) if local.is_file() => {
            log::warn!("grepcut-models: {message}; serving existing cache");
        }
        Err(message) => {
            log::warn!("grepcut-models: {message}");
            return error_body(StatusCode::BAD_GATEWAY, message);
        }
    }

    serve_file(request, local)
}
