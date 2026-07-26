use super::types::{ParakeetModelStatus, TranscriptionError};
use crate::infra::model_cache::download_model_file_to_cache;
use crate::infra::model_download::{
    download_url_to_file, emit_model_download_event, extract_tar_bz2, sha256_file,
};
use std::fs::{self};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const MODEL_DIR_NAME: &str = "nemo-parakeet-tdt-0.6b-v3-int8";
pub const LEGACY_MODEL_DIR_NAME: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
pub const MODEL_CDN_PREFIX: &str = "/models/nemo-parakeet-tdt-0.6b-v3-int8";
pub const DEV_MODEL_REL_PATH: &str = "public/models/nemo-parakeet-tdt-0.6b-v3-int8";
pub const MODEL_ARCHIVE_NAME: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
const MODEL_MANIFEST_FILE: &str = "manifest.json";
pub const MODEL_DOWNLOAD_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";

const REQUIRED_FILES: [&str; 4] = [
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];

static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());

pub fn model_dir_for_app(app: &AppHandle) -> Result<PathBuf, String> {
    model_subdir_for_app(app, MODEL_DIR_NAME)
}

pub fn legacy_model_dir_for_app(app: &AppHandle) -> Result<PathBuf, String> {
    model_subdir_for_app(app, LEGACY_MODEL_DIR_NAME)
}

fn model_subdir_for_app(app: &AppHandle, dir_name: &str) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve data directory: {error}"))?;
    Ok(data_dir.join("models").join(dir_name))
}

pub fn dev_model_dir() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(DEV_MODEL_REL_PATH);
        if dev.is_dir() {
            return Some(dev);
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = ();
    None
}

pub fn env_model_dir() -> Option<PathBuf> {
    for variable in ["PARAKEET_MODEL_DIR", "SHERPA_ONNX_MODEL_DIR"] {
        if let Ok(path) = std::env::var(variable) {
            let directory = PathBuf::from(path);
            if directory.is_dir() {
                return Some(directory);
            }
        }
    }
    None
}

pub fn resolve_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_model_location(app)?.path)
}

pub fn resolve_model_location(app: &AppHandle) -> Result<ResolvedModelLocation, String> {
    let cache_dir = model_dir_for_app(app)?;
    let legacy_dir = legacy_model_dir_for_app(app)?;

    if let Some((path, source)) = select_model_source(
        env_model_dir().as_deref(),
        dev_model_dir().as_deref(),
        &cache_dir,
        &legacy_dir,
    ) {
        if source == "legacy_cache" {
            log::info!(
                "Parakeet: using legacy downloaded model at {}",
                path.display()
            );
        }
        return Ok(ResolvedModelLocation::new(path.to_path_buf(), source));
    }

    Ok(ResolvedModelLocation::new(cache_dir, "missing"))
}

fn select_model_source<'a>(
    env: Option<&'a Path>,
    dev: Option<&'a Path>,
    cache: &'a Path,
    legacy: &'a Path,
) -> Option<(&'a Path, &'static str)> {
    if let Some(directory) = env.filter(|dir| is_model_installed(dir)) {
        return Some((directory, "env"));
    }

    if let Some(directory) = dev.filter(|dir| is_dev_model_ready(dir)) {
        return Some((directory, "dev_public"));
    }

    if is_model_installed(cache) {
        return Some((cache, "cache"));
    }

    if try_migrate_legacy_cache(cache, legacy).is_some() {
        return Some((cache, "cache"));
    }

    if is_model_installed(legacy) {
        return Some((legacy, "legacy_cache"));
    }

    None
}

fn is_dev_model_ready(model_dir: &Path) -> bool {
    // Existence only — full SHA verify belongs in download/install, not resolve/status.
    is_model_installed(model_dir)
}

fn try_migrate_legacy_cache(cache_dir: &Path, legacy_dir: &Path) -> Option<()> {
    if is_model_installed(cache_dir) || !is_model_installed(legacy_dir) {
        return None;
    }
    if let Some(parent) = cache_dir.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::rename(legacy_dir, cache_dir) {
        Ok(()) => {
            log::info!("Parakeet: migrated legacy model to {}", cache_dir.display());
            Some(())
        }
        Err(error) => {
            log::warn!("Parakeet: legacy migration failed ({error}); using legacy path");
            None
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedModelLocation {
    pub path: PathBuf,
    pub source: &'static str,
    pub manifest_valid: bool,
}

impl ResolvedModelLocation {
    fn new(path: PathBuf, source: &'static str) -> Self {
        // ponytail: skip SHA-256 of ~671MB ONNX on every status/resolve; verify only on download/install
        Self {
            path,
            source,
            manifest_valid: false,
        }
    }
}

pub fn is_model_installed(model_dir: &Path) -> bool {
    REQUIRED_FILES
        .iter()
        .all(|file| model_dir.join(file).is_file())
}

pub fn model_status(
    app: &AppHandle,
    loaded: bool,
    provider: Option<String>,
) -> Result<ParakeetModelStatus, String> {
    let location = resolve_model_location(app)?;
    let installed = is_model_installed(&location.path);
    log::info!(
        "Parakeet model status: installed={installed} source={} path={} loaded={loaded} provider={:?}",
        location.source,
        location.path.display(),
        provider
    );
    Ok(ParakeetModelStatus {
        installed,
        loaded,
        path: if installed {
            location.path.to_str().map(str::to_owned)
        } else {
            None
        },
        provider,
        source: Some(location.source.to_string()),
        // Not verified on status path (would SHA-hash ~671 MB).
        manifest_valid: None,
    })
}

pub fn delete_model(app: &AppHandle) -> Result<(), String> {
    let model_dir = model_dir_for_app(app)?;
    if model_dir.exists() {
        fs::remove_dir_all(&model_dir)
            .map_err(|error| format!("Nie udało się usunąć modelu: {error}"))?;
    }
    let legacy_dir = legacy_model_dir_for_app(app)?;
    if legacy_dir.exists() {
        fs::remove_dir_all(&legacy_dir)
            .map_err(|error| format!("Nie udało się usunąć legacy modelu: {error}"))?;
    }
    let archive = model_dir
        .parent()
        .map(|parent| parent.join(MODEL_ARCHIVE_NAME));
    if let Some(archive) = archive {
        if archive.is_file() {
            let _ = fs::remove_file(archive);
        }
    }
    Ok(())
}

pub fn download_and_install_model(app: &AppHandle) -> Result<PathBuf, TranscriptionError> {
    ensure_model_files(app)
}

pub fn ensure_model_files(app: &AppHandle) -> Result<PathBuf, TranscriptionError> {
    let _guard = DOWNLOAD_LOCK
        .lock()
        .map_err(|_| TranscriptionError::ModelLoad("Download lock poisoned".into()))?;

    let cache_dir = model_dir_for_app(app).map_err(|error| TranscriptionError::ModelLoad(error))?;
    if is_model_installed(&cache_dir) {
        if verify_manifest(&cache_dir).is_ok() {
            return Ok(cache_dir);
        }
        log::warn!("Parakeet cache failed manifest verification; re-downloading");
        let _ = fs::remove_dir_all(&cache_dir);
    }

    if let Some(directory) = dev_model_dir() {
        if is_model_installed(&directory) && verify_manifest(&directory).is_ok() {
            return Ok(directory);
        }
    }

    let models_root = cache_dir
        .parent()
        .ok_or_else(|| TranscriptionError::ModelLoad("Brak katalogu models".into()))?;
    fs::create_dir_all(models_root).map_err(|error| {
        TranscriptionError::ModelLoad(format!("Nie udało się utworzyć katalogu: {error}"))
    })?;
    fs::create_dir_all(&cache_dir).map_err(|error| {
        TranscriptionError::ModelLoad(format!("Nie udało się utworzyć katalogu modelu: {error}"))
    })?;

    // The per-model manifest is required to validate the four model files.
    // Download it first; previously the CDN path could never complete because
    // only REQUIRED_FILES were fetched and verify_manifest then lacked it.
    let manifest_local = cache_dir.join(MODEL_MANIFEST_FILE);
    let manifest_remote = format!("{MODEL_CDN_PREFIX}/{MODEL_MANIFEST_FILE}");
    let mut cdn_failed =
        download_model_file_to_cache(app, &manifest_local, &manifest_remote).is_err();
    if !cdn_failed {
        for file in REQUIRED_FILES {
            let local = cache_dir.join(file);
            if local.is_file() && verify_file_hash(&local, file).unwrap_or(false) {
                continue;
            }
            let remote = format!("{MODEL_CDN_PREFIX}/{file}");
            if download_model_file_to_cache(app, &local, &remote).is_err() {
                cdn_failed = true;
                break;
            }
        }
    }

    if cdn_failed || !is_model_installed(&cache_dir) {
        download_archive_fallback(app, models_root)?;
        extract_archive(app, &models_root.join(MODEL_ARCHIVE_NAME), models_root)?;
        rename_extracted_dir(models_root)?;
    }

    if !is_model_installed(&cache_dir) {
        return Err(TranscriptionError::ModelLoad(
            "Po pobraniu brakuje wymaganych plików modelu".into(),
        ));
    }
    verify_manifest(&cache_dir)?;
    Ok(cache_dir)
}

fn rename_extracted_dir(models_root: &Path) -> Result<(), TranscriptionError> {
    let extracted = models_root.join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
    let target = models_root.join(MODEL_DIR_NAME);
    if extracted.is_dir() && !target.is_dir() {
        fs::rename(&extracted, &target).map_err(|error| {
            TranscriptionError::ModelLoad(format!("Nie udało się przenieść modelu: {error}"))
        })?;
    }
    Ok(())
}

fn verify_manifest(model_dir: &Path) -> Result<(), TranscriptionError> {
    let manifest_path = model_dir.join(MODEL_MANIFEST_FILE);
    let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
        TranscriptionError::ModelLoad(format!(
            "Brak manifestu modelu ({}): {error}",
            manifest_path.display()
        ))
    })?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        TranscriptionError::ModelLoad(format!("Nieprawidłowy manifest modelu: {error}"))
    })?;
    let files = manifest["files"].as_object().ok_or_else(|| {
        TranscriptionError::ModelLoad("Manifest modelu nie zawiera sekcji files".into())
    })?;

    for file in REQUIRED_FILES {
        let expected = files
            .get(file)
            .and_then(|entry| entry["sha256"].as_str())
            .ok_or_else(|| {
                TranscriptionError::ModelLoad(format!("Manifest nie zawiera SHA dla {file}"))
            })?;
        let path = model_dir.join(file);
        let actual = sha256_file(&path).map_err(|error| {
            TranscriptionError::ModelLoad(format!("Nie można odczytać {}: {error}", path.display()))
        })?;
        if actual != expected {
            return Err(TranscriptionError::ModelLoad(format!(
                "SHA-256 niezgodny dla {file}"
            )));
        }
    }
    Ok(())
}

fn verify_file_hash(path: &Path, file_name: &str) -> Result<bool, TranscriptionError> {
    let manifest_path = path.parent().unwrap_or(path).join(MODEL_MANIFEST_FILE);
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| TranscriptionError::ModelLoad(format!("Brak manifestu: {error}")))?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| TranscriptionError::ModelLoad(format!("Manifest: {error}")))?;
    let expected = manifest["files"][file_name]["sha256"]
        .as_str()
        .ok_or_else(|| TranscriptionError::ModelLoad(format!("Brak SHA dla {file_name}")))?;
    let actual = sha256_file(path).map_err(|error| TranscriptionError::ModelLoad(error))?;
    Ok(actual == expected)
}

fn download_archive_fallback(
    app: &AppHandle,
    models_root: &Path,
) -> Result<(), TranscriptionError> {
    let archive_path = models_root.join(MODEL_ARCHIVE_NAME);
    if archive_path.is_file() {
        return Ok(());
    }
    download_archive(app, &archive_path)
}

fn download_archive(app: &AppHandle, archive_path: &Path) -> Result<(), TranscriptionError> {
    download_url_to_file(
        app,
        MODEL_DOWNLOAD_URL,
        archive_path,
        MODEL_ARCHIVE_NAME,
        None,
        None,
    )
    .map_err(|error| TranscriptionError::ModelLoad(error))
}

fn extract_archive(
    app: &AppHandle,
    archive_path: &Path,
    models_root: &Path,
) -> Result<(), TranscriptionError> {
    extract_tar_bz2(archive_path, models_root).map_err(|error| {
        TranscriptionError::ModelLoad(format!("Rozpakowywanie archiwum nie powiodło się: {error}"))
    })?;
    emit_model_download_event(app, MODEL_DIR_NAME, 1, Some(1), true, None);
    Ok(())
}
