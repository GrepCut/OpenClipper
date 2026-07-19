mod bytetrack;
mod clipper_border;
mod clipper_extract;
mod clipper_frames;
mod clipper_subjects;
mod histogram;
mod native_jobs;
mod scene_detection;
mod types;
mod vision_logic;
#[cfg(windows)]
mod winml_pipeline;
#[cfg(windows)]
mod winml_vision;

use clipper_extract::extract_clipper_media_blocking;
pub(crate) use clipper_frames::{
    extract_clipper_segment_to_path_blocking, extract_frame_rgb_at_timestamp,
};
use clipper_frames::{extract_clipper_segment_blocking, snap_to_keyframe_blocking};
pub use native_jobs::{NativeJobEmitter, NativeJobRegistry};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, OnceLock};
use tauri::{command, AppHandle, Manager, State, WebviewWindow};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperWinMlCapability {
    available: bool,
    model_version: Option<&'static str>,
    reason_code: Option<&'static str>,
    reason: Option<String>,
}

#[cfg(windows)]
fn windows_build_number() -> Option<u32> {
    #[repr(C)]
    struct RtlOsVersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        service_pack: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(version: *mut RtlOsVersionInfo) -> i32;
    }
    let mut version = RtlOsVersionInfo {
        size: std::mem::size_of::<RtlOsVersionInfo>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        service_pack: [0; 128],
    };
    let status = unsafe { RtlGetVersion(&mut version) };
    (status >= 0).then_some(version.build)
}

/// Cheap startup/process probe. Model sessions and device calibration are
/// deliberately deferred until `start_clipper_winml_analysis` receives its
/// first real frame.
#[command]
pub async fn probe_clipper_winml(app_handle: AppHandle) -> ClipperWinMlCapability {
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        ClipperWinMlCapability {
            available: false,
            model_version: None,
            reason_code: Some("unsupported_os"),
            reason: Some("WinML is available only on supported Windows builds.".into()),
        }
    }
    #[cfg(windows)]
    {
        use sha2::{Digest, Sha256};
        let build = windows_build_number().unwrap_or(0);
        if build < 19041 {
            return ClipperWinMlCapability {
                available: false,
                model_version: None,
                reason_code: Some("unsupported_os"),
                reason: Some(format!(
                    "Windows build {build} is older than required build 19041."
                )),
            };
        }
        let resource_dir = match app_handle.path().resource_dir() {
            Ok(path) => path,
            Err(error) => {
                return ClipperWinMlCapability {
                    available: false,
                    model_version: None,
                    reason_code: Some("model_missing"),
                    reason: Some(format!("Cannot resolve resource directory: {error}")),
                }
            }
        };
        let resources = winml_vision::resource_paths(&resource_dir);
        let root = resources.face.parent().unwrap_or(&resource_dir);
        let manifest_path = root.join("manifest.json");
        let manifest = std::fs::read(&manifest_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        let Some(manifest) = manifest else {
            return ClipperWinMlCapability {
                available: false,
                model_version: None,
                reason_code: Some("model_missing"),
                reason: Some(format!("Missing or invalid {}", manifest_path.display())),
            };
        };
        for (name, path) in [
            ("blaze_face_full_range", resources.face),
            ("autoflip_ssdlite", resources.ssd),
            ("movenet_multipose_lightning", resources.pose),
            ("yolox_tiny", resources.yolox),
            ("lr_asd_ava", resources.active_speaker),
        ] {
            let expected = manifest["models"][name]["onnxSha256"].as_str();
            let actual = std::fs::read(&path)
                .ok()
                .map(|bytes| format!("{:x}", Sha256::digest(bytes)));
            if expected.is_none() || actual.as_deref() != expected {
                return ClipperWinMlCapability {
                    available: false,
                    model_version: None,
                    reason_code: Some(if path.is_file() {
                        "model_hash_mismatch"
                    } else {
                        "model_missing"
                    }),
                    reason: Some(format!("Invalid WinML resource {}", path.display())),
                };
            }
        }
        if !resources.ssd_labels.is_file() || !resources.yolox_labels.is_file() {
            return ClipperWinMlCapability {
                available: false,
                model_version: None,
                reason_code: Some("model_missing"),
                reason: Some("Missing detector label map".into()),
            };
        }
        ClipperWinMlCapability {
            available: true,
            model_version: Some("clipper-vision-v2"),
            reason_code: None,
            reason: None,
        }
    }
}

#[cfg(windows)]
#[command]
pub fn start_clipper_winml_analysis(
    session_id: String,
    job_id: String,
    file_path: String,
    start_time: f64,
    end_time: f64,
    tracking_mode: Option<String>,
    object_detector_mode: Option<String>,
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
    let detector_mode = winml_pipeline::ObjectDetectorMode::parse(object_detector_mode.as_deref());

    tauri::async_runtime::spawn(async move {
        let joined = tauri::async_runtime::spawn_blocking(move || {
            winml_pipeline::analyze(
                file_path,
                start_time,
                end_time,
                &resource_dir,
                task_cancelled,
                tracking_enabled,
                detector_mode,
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
    _object_detector_mode: Option<String>,
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

struct ClipperFrameJob {
    session_id: String,
    token: String,
    dir: PathBuf,
    active: bool,
    cleanup_requested: bool,
}

/// Frame storage outlives extraction while subject workers fetch its JPEGs.
/// Reload retirement requests cleanup, but active writers are deleted only
/// after their blocking extraction task has stopped.
static CLIPPER_FRAME_JOBS: OnceLock<Mutex<HashMap<String, ClipperFrameJob>>> = OnceLock::new();

fn clipper_frame_jobs() -> &'static Mutex<HashMap<String, ClipperFrameJob>> {
    CLIPPER_FRAME_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn delete_clipper_frame_storage(entry: ClipperFrameJob) {
    crate::media_protocol::unregister_media_token(&entry.token);
    std::thread::spawn(move || {
        let _ = std::fs::remove_dir_all(entry.dir);
    });
}

fn cleanup_clipper_frame_job(job_id: &str) {
    let entry = clipper_frame_jobs().lock().ok().and_then(|mut jobs| {
        if let Some(entry) = jobs.get_mut(job_id) {
            if entry.active {
                entry.cleanup_requested = true;
                return None;
            }
        }
        jobs.remove(job_id)
    });
    if let Some(entry) = entry {
        delete_clipper_frame_storage(entry);
    }
}

fn finish_clipper_frame_job(job_id: &str, succeeded: bool) {
    let entry = clipper_frame_jobs().lock().ok().and_then(|mut jobs| {
        let should_remove = if let Some(entry) = jobs.get_mut(job_id) {
            entry.active = false;
            !succeeded || entry.cleanup_requested
        } else {
            false
        };
        should_remove.then(|| jobs.remove(job_id)).flatten()
    });
    if let Some(entry) = entry {
        delete_clipper_frame_storage(entry);
    }
}

pub fn cleanup_clipper_frame_sessions(session_ids: &[String]) {
    if session_ids.is_empty() {
        return;
    }
    let retired: std::collections::HashSet<&str> = session_ids.iter().map(String::as_str).collect();
    let entries = clipper_frame_jobs()
        .lock()
        .ok()
        .map(|mut jobs| {
            let mut remove = Vec::new();
            for (job_id, entry) in jobs.iter_mut() {
                if retired.contains(entry.session_id.as_str()) {
                    if entry.active {
                        entry.cleanup_requested = true;
                    } else {
                        remove.push(job_id.clone());
                    }
                }
            }
            remove
                .into_iter()
                .filter_map(|job_id| jobs.remove(&job_id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for entry in entries {
        delete_clipper_frame_storage(entry);
    }
}

/// Usuwa cały cache klatek clippera z poprzednich sesji (pliki są per-sesyjne).
pub fn cleanup_clipper_frames_cache_on_startup(app: &AppHandle) {
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let frames_root = cache_dir.join("clipper-frames");
        std::thread::spawn(move || {
            let _ = std::fs::remove_dir_all(frames_root);
        });
    }
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

/// Unified extraction: one ffmpeg decode pass over the range yields both
/// face-candidate frames and (when `include_motion`) subject/motion samples.
#[command]
#[allow(clippy::too_many_arguments)]
pub fn start_clipper_media_extraction(
    session_id: String,
    job_id: String,
    file_path: String,
    start_time: f64,
    end_time: f64,
    interval_sec: f64,
    face_max_dimension: u32,
    subject_target_width: u32,
    include_motion: bool,
    app_handle: AppHandle,
    webview: WebviewWindow,
    jobs: State<'_, NativeJobRegistry>,
) -> Result<(), String> {
    let registry = jobs.inner().clone();
    let cancelled = registry.register(&session_id, &job_id)?;
    let frames_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| {
            registry.finish(&session_id, &job_id);
            format!("Cannot resolve cache directory: {error}")
        })?
        .join("clipper-frames")
        .join(&job_id);
    if let Err(error) = std::fs::create_dir_all(&frames_dir) {
        registry.finish(&session_id, &job_id);
        return Err(format!("Cannot create frames directory: {error}"));
    }
    let (token, frames_base_url) = match crate::media_protocol::register_media_dir(&frames_dir) {
        Ok(value) => value,
        Err(error) => {
            registry.finish(&session_id, &job_id);
            let _ = std::fs::remove_dir_all(&frames_dir);
            return Err(error);
        }
    };
    let mut frame_jobs = match clipper_frame_jobs().lock() {
        Ok(jobs) => jobs,
        Err(_) => {
            crate::media_protocol::unregister_media_token(&token);
            registry.finish(&session_id, &job_id);
            let _ = std::fs::remove_dir_all(&frames_dir);
            return Err("Frame job registry is poisoned".into());
        }
    };
    frame_jobs.insert(
        job_id.clone(),
        ClipperFrameJob {
            session_id: session_id.clone(),
            token,
            dir: frames_dir.clone(),
            active: true,
            cleanup_requested: false,
        },
    );
    drop(frame_jobs);

    let emitter = NativeJobEmitter::new(
        webview,
        session_id.clone(),
        job_id.clone(),
        cancelled.clone(),
    );
    let task_emitter = emitter.clone();
    let task_cancelled = cancelled.clone();
    let blocking_job_id = job_id.clone();
    let finish_registry = registry.clone();
    let finish_session_id = session_id.clone();
    let finish_job_id = job_id.clone();

    tauri::async_runtime::spawn(async move {
        let joined = tauri::async_runtime::spawn_blocking(move || {
            extract_clipper_media_blocking(
                file_path,
                start_time,
                end_time,
                interval_sec,
                face_max_dimension,
                subject_target_width,
                include_motion,
                blocking_job_id,
                frames_dir,
                frames_base_url,
                task_cancelled,
                move |progress| {
                    let _ = task_emitter.progress(&progress);
                },
            )
        })
        .await;

        let succeeded = matches!(&joined, Ok(Ok(_))) && !cancelled.load(Ordering::Acquire);
        if !cancelled.load(Ordering::Acquire) {
            match joined {
                Ok(Ok(summary)) => {
                    let _ = emitter.result(&summary);
                }
                Ok(Err(message)) => {
                    let failure = serde_json::json!({
                        "code": "extraction_failed",
                        "message": message,
                        "fatal": true,
                    });
                    let _ = emitter.error(&failure);
                }
                Err(error) => {
                    let failure = serde_json::json!({
                        "code": "extraction_failed",
                        "message": format!("Native task join error: {error}"),
                        "fatal": true,
                    });
                    let _ = emitter.error(&failure);
                }
            }
        }
        finish_clipper_frame_job(&finish_job_id, succeeded);
        finish_registry.finish(&finish_session_id, &finish_job_id);
    });
    Ok(())
}

/// Usuwa pliki klatek joba i wyrejestrowuje token z protokołu media.
/// Wywoływane przez frontend po zakończeniu (lub przerwaniu) detekcji twarzy.
#[command]
pub async fn cleanup_clipper_frames(job_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || cleanup_clipper_frame_job(&job_id))
        .await
        .map_err(|e| format!("Task join error: {e}"))
}
