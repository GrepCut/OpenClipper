use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use crate::video::ffmpeg::frames::extract_clipper_segment_to_path_blocking;
use crate::video::ffmpeg::studio_thumbnails::{
    extract_studio_thumbnails_blocking, studio_thumbnails_look_fresh,
    ExtractClipperStudioThumbnailsResult, StudioThumbnailsProgressEvent,
    STUDIO_THUMBNAILS_PROGRESS_EVENT,
};
use tauri::{AppHandle, Emitter, Manager};

const CLIPPER_TRIMMED_SEGMENT_FILE: &str = "clip-trimmed.mp4";
const CLIPPER_TRIM_METADATA_FILE: &str = "trim_metadata.json";
const CLIPPER_EXPORTS_SUBDIR: &str = "exports";

pub(crate) fn clipper_projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("Cannot resolve Documents directory: {error}"))?;
    Ok(documents.join("OpenClipper").join("projects"))
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

pub(crate) async fn extract_studio_thumbnails_for_project(
    app: &AppHandle,
    project_id: &str,
    duration_secs: Option<f64>,
    force: bool,
) -> Result<ExtractClipperStudioThumbnailsResult, String> {
    let dir = clipper_project_data_dir(app, project_id)?;
    let duration = duration_secs.unwrap_or(0.0);
    if !force && duration > 0.0 && studio_thumbnails_look_fresh(&dir, duration) {
        let raw = fs::read_to_string(dir.join(
            crate::video::ffmpeg::studio_thumbnails::CLIPPER_THUMBNAILS_INDEX_FILE,
        ))
        .map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("Invalid thumbnails index: {e}"))?;
        let count = value
            .get("frames")
            .and_then(|f| f.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        let height = value
            .get("height")
            .and_then(|h| h.as_u64())
            .unwrap_or(120) as u32;
        let interval_sec = value
            .get("intervalSec")
            .or_else(|| value.get("interval_sec"))
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let _ = app.emit(
            STUDIO_THUMBNAILS_PROGRESS_EVENT,
            StudioThumbnailsProgressEvent {
                project_id: project_id.to_string(),
                done: count.max(1),
                total: count.max(1),
                ratio: 1.0,
            },
        );
        return Ok(ExtractClipperStudioThumbnailsResult {
            index_file_name: crate::video::ffmpeg::studio_thumbnails::CLIPPER_THUMBNAILS_INDEX_FILE
                .to_string(),
            pack_file_name: crate::video::ffmpeg::studio_thumbnails::CLIPPER_THUMBNAILS_PACK_FILE
                .to_string(),
            interval_sec,
            height,
            count,
        });
    }
    let app_for_blocking = app.clone();
    let project_id_for_blocking = project_id.to_string();
    tokio::task::spawn_blocking(move || {
        extract_studio_thumbnails_blocking(dir, Some(app_for_blocking), project_id_for_blocking)
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
