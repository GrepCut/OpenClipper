mod bytetrack;
mod clipper_border;
mod clipper_frames;
mod generalization_shadow;
mod histogram;
mod native_jobs;
mod scene_detection;
mod types;
mod vision_logic;
#[cfg(windows)]
mod winml_pipeline;
#[cfg(windows)]
mod winml_vision;


pub(crate) use clipper_frames::{
    extract_clipper_segment_to_path_blocking, extract_frame_rgb_at_timestamp,
};
use clipper_frames::{extract_clipper_segment_blocking, snap_to_keyframe_blocking};
pub use native_jobs::{NativeJobEmitter, NativeJobRegistry};
use std::sync::atomic::Ordering;
use tauri::{command, AppHandle, Manager, State, WebviewWindow};

#[cfg(windows)]
#[command]
pub fn start_clipper_winml_analysis(
    session_id: String,
    job_id: String,
    file_path: String,
    start_time: f64,
    end_time: f64,
    tracking_mode: Option<String>,
    app_handle: AppHandle,
    webview: WebviewWindow,
    jobs: State<'_, NativeJobRegistry>,
) -> Result<(), String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve resource directory: {error}"))?;
    let registry = jobs.inner().clone();
    let cancelled = registry.register(&session_id, &job_id)?;
    let emitter = NativeJobEmitter::new(
        webview,
        session_id.clone(),
        job_id.clone(),
        cancelled.clone(),
    );
    let task_emitter = emitter.clone();
    let task_cancelled = cancelled.clone();
    let finish_registry = registry.clone();
    let finish_session_id = session_id.clone();
    let finish_job_id = job_id.clone();
    let tracking_enabled = tracking_mode.as_deref().unwrap_or("bytetrack-v1") != "off";

    tauri::async_runtime::spawn(async move {
        let joined = tauri::async_runtime::spawn_blocking(move || {
            winml_pipeline::analyze(
                file_path,
                start_time,
                end_time,
                &resource_dir,
                task_cancelled,
                tracking_enabled,
                |progress| {
                    task_emitter.progress(&progress).map_err(|error| {
                        winml_vision::NativeVisionError::new("cancelled", error, false)
                    })
                },
            )
        })
        .await;

        if !cancelled.load(Ordering::Acquire) {
            match joined {
                Ok(Ok(summary)) => {
                    let _ = emitter.result(&summary);
                }
                Ok(Err(error)) => {
                    let _ = emitter.error(&error);
                }
                Err(error) => {
                    let failure = winml_vision::NativeVisionError::new(
                        "evaluation_failed",
                        format!("Native task join error: {error}"),
                        true,
                    );
                    let _ = emitter.error(&failure);
                }
            }
        }
        finish_registry.finish(&finish_session_id, &finish_job_id);
    });
    Ok(())
}

#[cfg(not(windows))]
#[command]
pub fn start_clipper_winml_analysis(
    _session_id: String,
    _job_id: String,
    _file_path: String,
    _start_time: f64,
    _end_time: f64,
    _tracking_mode: Option<String>,
    _app_handle: AppHandle,
    _webview: WebviewWindow,
    _jobs: State<'_, NativeJobRegistry>,
) -> Result<(), String> {
    Err("WinML is unavailable on this platform.".into())
}

#[command]
pub fn cancel_clipper_native_job(
    session_id: String,
    job_id: String,
    jobs: State<'_, NativeJobRegistry>,
) -> bool {
    jobs.cancel(&session_id, &job_id)
}

#[command]
pub async fn snap_clipper_to_keyframe(file_path: String, start_time: f64) -> Result<f64, String> {
    tokio::task::spawn_blocking(move || snap_to_keyframe_blocking(file_path, start_time))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[command]
pub async fn extract_clipper_segment(
    file_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tokio::task::spawn_blocking(move || {
        extract_clipper_segment_blocking(file_path, start_time, end_time)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}
