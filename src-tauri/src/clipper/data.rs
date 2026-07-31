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
