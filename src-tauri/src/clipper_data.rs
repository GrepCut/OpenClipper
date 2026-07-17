use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use crate::video_processing::extract_clipper_segment_to_path_blocking;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const CLIPPER_TRIMMED_SEGMENT_FILE: &str = "clip-trimmed.mp4";
const CLIPPER_TRIM_METADATA_FILE: &str = "trim_metadata.json";
const CLIPPER_EXPORTS_SUBDIR: &str = "exports";

fn clipper_projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data directory: {error}"))?;
    Ok(data_dir.join("projects"))
}

fn clipper_project_root(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(clipper_projects_root(app)?.join(project_id))
}

fn clipper_project_data_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(clipper_project_root(app, project_id)?.join("data"))
}

fn clipper_project_exports_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(clipper_project_data_dir(app, project_id)?.join(CLIPPER_EXPORTS_SUBDIR))
}

fn validate_export_file_name(file_name: &str) -> Result<(), String> {
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

fn clipper_export_file_path(
    app: &AppHandle,
    project_id: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    validate_export_file_name(file_name)?;
    Ok(clipper_project_exports_dir(app, project_id)?.join(file_name))
}

#[tauri::command]
pub fn open_clipper_projects_dir(app: AppHandle) -> Result<String, String> {
    let path = clipper_projects_root(&app)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_clipper_project_data_dir(
    app: AppHandle,
    project_id: String,
) -> Result<String, String> {
    let path = clipper_project_data_dir(&app, &project_id)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn remove_clipper_project_data_dir(app: AppHandle, project_id: String) -> Result<(), String> {
    let path = clipper_project_root(&app, &project_id)?;
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn read_clipper_project_data_file(
    app: AppHandle,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    let path = clipper_project_data_dir(&app, &project_id)?.join(file_name);
    tokio::task::spawn_blocking(move || fs::read_to_string(&path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_clipper_project_data_file(
    app: AppHandle,
    project_id: String,
    file_name: String,
    contents: String,
) -> Result<(), String> {
    let path = clipper_project_data_dir(&app, &project_id)?.join(&file_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_clipper_project_data_bytes(
    app: AppHandle,
    project_id: String,
    file_name: String,
    contents: Vec<u8>,
) -> Result<(), String> {
    let dir = clipper_project_data_dir(&app, &project_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(file_name), contents).map_err(|e| e.to_string())
}

/// Writes a project data file from Tauri's raw IPC body, avoiding JSON expansion
/// of large byte arrays in the webview. Project and file names are supplied as
/// small request headers; the request body contains only the file bytes.
#[tauri::command]
pub fn write_clipper_project_data_raw(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let project_id = request
        .headers()
        .get("x-clipper-project-id")
        .ok_or_else(|| "Missing x-clipper-project-id header.".to_string())?
        .to_str()
        .map_err(|error| format!("Invalid project id header: {error}"))?;
    let file_name = request
        .headers()
        .get("x-clipper-file-name")
        .ok_or_else(|| "Missing x-clipper-file-name header.".to_string())?
        .to_str()
        .map_err(|error| format!("Invalid file name header: {error}"))?;
    validate_export_file_name(file_name)?;

    let InvokeBody::Raw(contents) = request.body() else {
        return Err("Expected a raw binary request body.".to_string());
    };

    let dir = clipper_project_data_dir(&app, project_id)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    fs::write(dir.join(file_name), contents).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_clipper_project_data_file_path(
    app: AppHandle,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    let path = clipper_project_data_dir(&app, &project_id)?.join(&file_name);
    if !path.exists() {
        return Err(format!("File not found: {file_name}"));
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn extract_clipper_segment_to_project_data(
    app: AppHandle,
    project_id: String,
    file_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<String, String> {
    let dir = clipper_project_data_dir(&app, &project_id)?;
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

#[tauri::command]
pub fn ensure_clipper_project_exports_dir(
    app: AppHandle,
    project_id: String,
) -> Result<String, String> {
    let path = clipper_project_exports_dir(&app, &project_id)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_clipper_export_file_bytes_at(
    app: AppHandle,
    project_id: String,
    file_name: String,
    position: u64,
    contents: Vec<u8>,
) -> Result<(), String> {
    let dir = clipper_project_exports_dir(&app, &project_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = clipper_export_file_path(&app, &project_id, &file_name)?;
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(position))
        .map_err(|e| e.to_string())?;
    file.write_all(&contents).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_clipper_export_file(
    app: AppHandle,
    project_id: String,
    file_name: String,
) -> Result<(), String> {
    let path = clipper_export_file_path(&app, &project_id, &file_name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_clipper_export_file_path(
    app: AppHandle,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    let path = clipper_export_file_path(&app, &project_id, &file_name)?;
    if !path.exists() {
        return Err(format!("Export file not found: {file_name}"));
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn stat_clipper_export_file(
    app: AppHandle,
    project_id: String,
    file_name: String,
) -> Result<u64, String> {
    let path = clipper_export_file_path(&app, &project_id, &file_name)?;
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
pub fn open_clipper_project_exports_dir(
    app: AppHandle,
    project_id: String,
) -> Result<String, String> {
    let path = clipper_project_exports_dir(&app, &project_id)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
