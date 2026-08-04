use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use crate::video::ffmpeg::frames::extract_clipper_segment_to_path_blocking;
use tauri::AppHandle;
use tauri::Manager;

const CLIPPER_TRIMMED_SEGMENT_FILE: &str = "clip-trimmed.mp4";
const CLIPPER_TRIM_METADATA_FILE: &str = "trim_metadata.json";
const CLIPPER_EXPORTS_SUBDIR: &str = "exports";

pub(crate) fn clipper_projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data directory: {error}"))?;
    Ok(data_dir.join("projects"))
}

pub(crate) fn clipper_project_root(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(clipper_projects_root(app)?.join(project_id))
}

pub(crate) fn clipper_project_data_dir(
    app: &AppHandle,
    project_id: &str,
) -> Result<PathBuf, String> {
    Ok(clipper_project_root(app, project_id)?.join("data"))
}

/// Chrome/Edge block FSA directory access under AppData. Stage Studio import
/// files under the user Documents tree so `showDirectoryPicker` can grant them.
pub(crate) fn clipper_studio_import_staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("Cannot resolve Documents directory: {error}"))?;
    Ok(documents.join("OpenClipper").join("studio-import"))
}

pub(crate) fn stage_file_into_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if dst.exists() {
        fs::remove_file(dst).map_err(|error| format!("Failed to replace staged file: {error}"))?;
    }
    // Prefer hard link (same volume, no extra disk) then fall back to copy.
    if fs::hard_link(src, dst).is_ok() {
        return Ok(());
    }
    fs::copy(src, dst)
        .map_err(|error| format!("Failed to stage file {}: {error}", src.display()))?;
    Ok(())
}

pub(crate) fn clipper_project_exports_dir(
    app: &AppHandle,
    project_id: &str,
) -> Result<PathBuf, String> {
    Ok(clipper_project_data_dir(app, project_id)?.join(CLIPPER_EXPORTS_SUBDIR))
}

pub(crate) fn validate_export_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() {
        return Err("Export file name is empty.".to_string());
    }
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err(format!("Invalid export file name: {file_name}"));
    }
    let path = Path::new(file_name);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("Invalid export file name: {file_name}"));
    }
    Ok(())
}

pub(crate) fn clipper_export_file_path(
    app: &AppHandle,
    project_id: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    validate_export_file_name(file_name)?;
    Ok(clipper_project_exports_dir(app, project_id)?.join(file_name))
}

pub(crate) fn clipper_export_file_exists(
    app: &AppHandle,
    project_id: &str,
    file_name: &str,
) -> bool {
    clipper_export_file_path(app, project_id, file_name)
        .map(|path| path.is_file())
        .unwrap_or(false)
}

pub(crate) fn validate_clipper_audio_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err("Audio path must be absolute.".to_string());
    }
    let root = clipper_projects_root(app)?
        .canonicalize()
        .map_err(|error| format!("Cannot resolve clipper projects root: {error}"))?;
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("Invalid audio path: {error}"))?;
    if !resolved.starts_with(&root) {
        return Err("Audio path is outside clipper project data.".to_string());
    }
    if !resolved.is_file() {
        return Err("Audio file not found.".to_string());
    }
    Ok(resolved)
}

pub(crate) async fn extract_segment_to_project_data(
    app: &AppHandle,
    project_id: &str,
    file_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<String, String> {
    let dir = clipper_project_data_dir(app, project_id)?;
    tokio::task::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let output_path = dir.join(CLIPPER_TRIMMED_SEGMENT_FILE);
        extract_clipper_segment_to_path_blocking(file_path, start_time, end_time, &output_path)?;
        let metadata = serde_json::json!({
            "clipStart": start_time,
            "clipEnd": end_time,
        });
        fs::write(dir.join(CLIPPER_TRIM_METADATA_FILE), metadata.to_string())
            .map_err(|e| e.to_string())?;
        Ok(output_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

pub(crate) fn write_export_file_bytes_at(
    app: &AppHandle,
    project_id: &str,
    file_name: &str,
    position: u64,
    contents: &[u8],
) -> Result<(), String> {
    let dir = clipper_project_exports_dir(app, project_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = clipper_export_file_path(app, project_id, file_name)?;
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(position))
        .map_err(|e| e.to_string())?;
    file.write_all(contents).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn write_project_data_file_bytes_at(
    app: &AppHandle,
    project_id: &str,
    file_name: &str,
    position: u64,
    contents: &[u8],
) -> Result<(), String> {
    validate_export_file_name(file_name)?;
    let dir = clipper_project_data_dir(app, project_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(file_name);
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if position == 0 {
        file.set_len(0).map_err(|e| e.to_string())?;
    }
    file.seek(SeekFrom::Start(position))
        .map_err(|e| e.to_string())?;
    file.write_all(contents).map_err(|e| e.to_string())?;
    Ok(())
}
