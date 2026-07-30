use crate::clipper::data::{clipper_export_file_path, clipper_project_exports_dir, validate_export_file_name};
use crate::video::ffmpeg::export::{
    cancel_native_export, export_format_native_blocking, NativeCropTimeline, NativeExportResult,
};
use crate::video::ffmpeg::frames::{extract_clipper_segment_blocking, snap_to_keyframe_blocking};
use crate::video::jobs::registry::{NativeJobEmitter, NativeJobRegistry};
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
    vision_ablation: Option<crate::video::smart_crop::pipeline::VisionAblationConfig>,
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
    let tracking_enabled = tracking_mode.as_deref().unwrap_or("bytetrack-v2") != "off";
    let vision_ablation = vision_ablation.unwrap_or_default();

    tauri::async_runtime::spawn(async move {
        let joined = tauri::async_runtime::spawn_blocking(move || {
            crate::video::smart_crop::pipeline::analyze(
                file_path,
                start_time,
                end_time,
                &resource_dir,
                task_cancelled,
                tracking_enabled,
                vision_ablation,
                |progress| {
                    task_emitter.progress(&progress).map_err(|error| {
                        crate::video::smart_crop::vision::NativeVisionError::new(
                            "cancelled",
                            error,
                            false,
                        )
                    })
                },
            )
        })
        .await;

        match joined {
            Ok(Ok(summary)) if !cancelled.load(Ordering::Acquire) => {
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    "emitting successful native analysis result",
                );
                let emitted = emitter.result(&summary);
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!("native analysis result emitted ok={}", emitted.is_ok()),
                );
            }
            Ok(Ok(_)) => {
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    "successful native analysis result suppressed after cancellation",
                );
            }
            Ok(Err(error)) if error.code == "cancelled" => {
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!(
                        "native analysis cancellation acknowledged message={}",
                        error.message
                    ),
                );
            }
            Ok(Err(error)) => {
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!(
                        "emitting error code={} fatal={} message={}",
                        error.code, error.fatal, error.message
                    ),
                );
                let emitted = emitter.error(&error);
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!("native analysis error emitted ok={}", emitted.is_ok()),
                );
            }
            Err(error) if !cancelled.load(Ordering::Acquire) => {
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!("spawn_blocking join error: {error}"),
                );
                let failure = crate::video::smart_crop::vision::NativeVisionError::new(
                    "evaluation_failed",
                    format!("Native task join error: {error}"),
                    true,
                );
                let emitted = emitter.error(&failure);
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!("native task join error emitted ok={}", emitted.is_ok()),
                );
            }
            Err(error) => {
                crate::video::smart_crop::diagnostics::append(
                    "command",
                    &format!("spawn_blocking join error suppressed after cancellation: {error}"),
                );
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
    _vision_ablation: Option<serde_json::Value>,
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

#[command]
pub fn probe_caption_gpu() -> bool {
    crate::video::caption_gpu::probe_caption_gpu()
}

#[command]
pub async fn export_clipper_format_native(
    app: AppHandle,
    job_id: String,
    project_id: String,
    input_path: String,
    output_file_name: String,
    timeline_json: String,
    ass_content: Option<String>,
    caption_scene_json: Option<String>,
    quality: String,
    mute_audio: bool,
    duration_sec: f64,
) -> Result<NativeExportResult, String> {
    validate_export_file_name(&output_file_name)?;
    let timeline: NativeCropTimeline = serde_json::from_str(&timeline_json)
        .map_err(|e| format!("Invalid crop timeline JSON: {e}"))?;
    let exports_dir = clipper_project_exports_dir(&app, &project_id)?;
    std::fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;
    let output_path = clipper_export_file_path(&app, &project_id, &output_file_name)?;
    let input = std::path::PathBuf::from(input_path);

    let app_for_task = app.clone();
    let job_id_task = job_id.clone();
    tokio::task::spawn_blocking(move || {
        export_format_native_blocking(
            &app_for_task,
            &job_id_task,
            &input,
            &output_path,
            &timeline,
            ass_content.as_deref(),
            caption_scene_json.as_deref(),
            &quality,
            mute_audio,
            duration_sec,
        )
    })
    .await
    .map_err(|e| format!("Native export join error: {e}"))?
}

#[command]
pub fn cancel_clipper_native_export(job_id: String) -> bool {
    cancel_native_export(&job_id)
}
