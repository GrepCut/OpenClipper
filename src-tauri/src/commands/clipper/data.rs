use crate::clipper::data::{
    clipper_export_file_path, clipper_project_data_dir, clipper_project_exports_dir,
    clipper_project_root, clipper_projects_root, extract_segment_to_project_data,
    validate_export_file_name, write_export_file_bytes_at, write_project_data_file_bytes_at,
};
use std::fs;
use tauri::ipc::{InvokeBody, Request};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

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
pub async fn remove_clipper_project_data_dir(
    app: AppHandle,
    db: tauri::State<'_, crate::storage::database::LocalDb>,
    project_id: String,
) -> Result<(), String> {
    crate::storage::export_cleanup::delete_project_exports(&db.database, &project_id)
        .await
        .map_err(|error| error.to_string())?;

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

#[tauri::command]
pub fn write_clipper_project_data_bytes_at(
    app: AppHandle,
    project_id: String,
    file_name: String,
    position: u64,
    contents: Vec<u8>,
) -> Result<(), String> {
    write_project_data_file_bytes_at(&app, &project_id, &file_name, position, &contents)
}

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
    extract_segment_to_project_data(&app, &project_id, file_path, start_time, end_time).await
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
    write_export_file_bytes_at(&app, &project_id, &file_name, position, &contents)
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
pub fn copy_clipper_export_file(
    app: AppHandle,
    project_id: String,
    file_name: String,
    destination_path: String,
) -> Result<(), String> {
    let source = clipper_export_file_path(&app, &project_id, &file_name)?;
    if !source.exists() {
        return Err(format!("Export file not found: {file_name}"));
    }
    fs::copy(&source, &destination_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
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
