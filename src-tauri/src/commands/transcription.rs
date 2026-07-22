use crate::transcription::{
    model_manager::{delete_model, download_and_install_model, model_status},
    ParakeetCapability, ParakeetModelStatus, ParakeetService, ParakeetTranscribeRequest,
    ParakeetTranscriptionProgress, ParakeetTranscriptionResult, TranscriptionError,
};
use crate::video::{NativeJobEmitter, NativeJobRegistry};
use crossbeam_channel;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};

#[tauri::command]
pub fn get_parakeet_model_status(
    service: State<'_, Arc<ParakeetService>>,
) -> Result<ParakeetModelStatus, String> {
    model_status(&service.app, service.is_loaded(), service.active_provider())
}

#[tauri::command]
pub async fn probe_parakeet_transcription(
    service: State<'_, Arc<ParakeetService>>,
) -> Result<ParakeetCapability, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match service.probe_capability() {
        Ok((available, provider, model_installed)) => Ok(ParakeetCapability {
            available,
            provider,
            model_installed,
            reason: if available {
                None
            } else if !model_installed {
                Some("Model nie jest zainstalowany.".into())
            } else {
                Some("Nie udało się uruchomić inferencji Parakeet.".into())
            },
        }),
        Err(TranscriptionError::ModelNotInstalled) => Ok(ParakeetCapability {
            available: false,
            provider: None,
            model_installed: false,
            reason: Some("Model nie jest zainstalowany.".into()),
        }),
        Err(error) => Err(error.to_string()),
    })
    .await
    .map_err(|error| format!("Probe task failed: {error}"))?
}

#[tauri::command]
pub async fn download_parakeet_model(
    app: tauri::AppHandle,
    service: State<'_, Arc<ParakeetService>>,
) -> Result<(), String> {
    let app_for_download = app.clone();
    tauri::async_runtime::spawn_blocking(move || download_and_install_model(&app_for_download))
        .await
        .map_err(|error| format!("Download task failed: {error}"))?
        .map_err(|error| error.to_string())?;
    service.unload();
    Ok(())
}

#[tauri::command]
pub fn delete_parakeet_model(
    app: tauri::AppHandle,
    service: State<'_, Arc<ParakeetService>>,
) -> Result<(), String> {
    service.unload();
    delete_model(&app)
}

#[tauri::command]
pub fn load_parakeet_model(service: State<'_, Arc<ParakeetService>>) -> Result<(), String> {
    service.ensure_worker().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transcribe_parakeet_local(
    request: ParakeetTranscribeRequest,
    service: State<'_, Arc<ParakeetService>>,
) -> Result<ParakeetTranscriptionResult, String> {
    let audio_path = request.audio_path;
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.transcribe(audio_path))
        .await
        .map_err(|error| format!("Transcription task failed: {error}"))?
        .map_err(|error: TranscriptionError| error.to_string())
}

#[tauri::command]
pub fn start_parakeet_transcription(
    session_id: String,
    job_id: String,
    request: ParakeetTranscribeRequest,
    service: State<'_, Arc<ParakeetService>>,
    app_handle: AppHandle,
    webview: WebviewWindow,
    jobs: State<'_, NativeJobRegistry>,
) -> Result<(), String> {
    let registry = jobs.inner().clone();
    let cancelled = registry.register(&session_id, &job_id)?;
    let emitter = NativeJobEmitter::new(
        webview,
        session_id.clone(),
        job_id.clone(),
        cancelled.clone(),
    );
    let service = service.inner().clone();
    let audio_path = request.audio_path;
    let task_emitter = emitter.clone();
    let finish_registry = registry.clone();
    let finish_session_id = session_id.clone();
    let finish_job_id = job_id.clone();

    tauri::async_runtime::spawn(async move {
        let (progress_tx, progress_rx) =
            crossbeam_channel::unbounded::<ParakeetTranscriptionProgress>();
        let forward_cancelled = cancelled.clone();
        let forward_emitter = task_emitter.clone();
        let forward_handle = tauri::async_runtime::spawn(async move {
            while let Ok(progress) = progress_rx.recv() {
                if forward_cancelled.load(Ordering::Acquire) {
                    break;
                }
                if forward_emitter.progress(&progress).is_err() {
                    break;
                }
            }
        });

        let joined = tauri::async_runtime::spawn_blocking({
            let cancelled = cancelled.clone();
            move || service.transcribe_with_job(audio_path, cancelled, Some(progress_tx))
        })
        .await;

        forward_handle.abort();

        if !cancelled.load(Ordering::Acquire) {
            match joined {
                Ok(Ok(result)) => {
                    let _ = emitter.result(&result);
                }
                Ok(Err(error)) => {
                    let _ = emitter.error(&serde_json::json!({
                        "message": error.to_string(),
                        "fatal": true,
                    }));
                }
                Err(error) => {
                    let _ = emitter.error(&serde_json::json!({
                        "message": format!("Native task join error: {error}"),
                        "fatal": true,
                    }));
                }
            }
        }
        finish_registry.finish(&finish_session_id, &finish_job_id);
        let _ = app_handle;
    });

    Ok(())
}
