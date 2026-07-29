use crate::transcription::{
    model_manager::{delete_model, download_and_install_model, model_status},
    vocals_isolate::{self, VocalsIsolateModelStatus},
    ParakeetCapability, ParakeetModelStatus, ParakeetService, ParakeetTranscribeRequest,
    LocalTranscriptionProgress, ParakeetTranscriptionProgress, ParakeetTranscriptionResult,
    TranscriptionError,
    WhisperModelStatus, WhisperTranscribeRequest, WhisperTranscriptionResult,
};
use crate::video::{NativeJobEmitter, NativeJobRegistry};
use crossbeam_channel;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};

fn resolve_asr_audio_path(
    app: &AppHandle,
    request_path: &str,
    isolate_vocals: bool,
    cancelled: Option<&AtomicBool>,
    mut on_progress: Option<&mut dyn FnMut(LocalTranscriptionProgress) -> Result<(), String>>,
) -> Result<String, String> {
    if !isolate_vocals {
        return Ok(request_path.to_owned());
    }
    let input = Path::new(request_path);
    let output = vocals_isolate::vocals_output_path(input);
    if let Some(callback) = on_progress.as_deref_mut() {
        callback(LocalTranscriptionProgress {
            phase: "isolating_vocals".into(),
            chunk_index: 0,
            chunk_count: 0,
            ratio: 0.0,
            provider: Some("cpu".into()),
        })?;
    }
    if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
        return Err(TranscriptionError::Cancelled.to_string());
    }
    let mut last_ratio = 0.0f64;
    let provider = {
        let progress_slot = &mut on_progress;
        vocals_isolate::isolate_vocals_to_wav(
            app,
            input,
            &output,
            Some(&mut |ratio| {
                if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                    return Err(TranscriptionError::Cancelled.to_string());
                }
                last_ratio = ratio;
                if let Some(callback) = progress_slot.as_deref_mut() {
                    callback(LocalTranscriptionProgress {
                        phase: "isolating_vocals".into(),
                        chunk_index: 0,
                        chunk_count: 0,
                        ratio,
                        provider: Some("cpu".into()),
                    })?;
                }
                Ok(())
            }),
        )?
    };
    if let Some(callback) = on_progress.as_deref_mut() {
        callback(LocalTranscriptionProgress {
            phase: "isolating_vocals".into(),
            chunk_index: 0,
            chunk_count: 0,
            ratio: last_ratio.max(1.0),
            provider: Some(provider),
        })?;
    }
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_parakeet_model_status(
    service: State<'_, Arc<ParakeetService>>,
) -> Result<ParakeetModelStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        model_status(&service.app, service.is_loaded(), service.active_provider())
    })
    .await
    .map_err(|error| format!("Status task failed: {error}"))?
}

#[tauri::command]
pub async fn get_whisper_model_status(app: tauri::AppHandle) -> Result<WhisperModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || crate::transcription::whisper_genai::model_status(&app))
        .await
        .map_err(|error| format!("Whisper status task failed: {error}"))?
}

#[tauri::command]
pub fn delete_whisper_model(app: tauri::AppHandle) -> Result<(), String> {
    crate::transcription::whisper_genai::delete_model(&app)
}

#[tauri::command]
pub async fn download_whisper_model(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::transcription::whisper_genai::download_and_install_model(&app)
    })
    .await
    .map_err(|error| format!("Whisper download task failed: {error}"))?
    .map(|_| ())
}

#[tauri::command]
pub async fn transcribe_whisper_local(
    request: WhisperTranscribeRequest,
    app: tauri::AppHandle,
) -> Result<WhisperTranscriptionResult, String> {
    log::info!(
        "Whisper command: queued transcription audio={} language={}",
        request.audio_path,
        request.language.as_deref().unwrap_or("auto")
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        let audio_path = resolve_asr_audio_path(
            &app,
            &request.audio_path,
            request.isolate_vocals,
            None,
            None,
        )?;
        crate::transcription::whisper_genai::transcribe(&app, &audio_path, request.language.as_deref())
    })
    .await
    .map_err(|error| format!("Whisper transcription task failed: {error}"))?;
    match &result {
        Ok(value) => log::info!(
            "Whisper command: completed duration_ms={} processing_ms={} words={}",
            value.duration_ms,
            value.processing_time_ms,
            value.words.len()
        ),
        Err(error) => log::error!("Whisper command: transcription failed: {error}"),
    }
    result
}

#[tauri::command]
pub fn start_whisper_transcription(
    session_id: String,
    job_id: String,
    request: WhisperTranscribeRequest,
    app: AppHandle,
    webview: WebviewWindow,
    jobs: State<'_, NativeJobRegistry>,
) -> Result<(), String> {
    let registry = jobs.inner().clone();
    let cancelled = registry.register(&session_id, &job_id)?;
    let emitter = NativeJobEmitter::new(webview, session_id.clone(), job_id.clone(), cancelled.clone());
    let finish_registry = registry.clone();
    let finish_session_id = session_id.clone();
    let finish_job_id = job_id.clone();

    tauri::async_runtime::spawn(async move {
        let (progress_tx, progress_rx) = crossbeam_channel::unbounded::<LocalTranscriptionProgress>();
        let forward_cancelled = cancelled.clone();
        let forward_emitter = emitter.clone();
        let forward_handle = tauri::async_runtime::spawn(async move {
            while let Ok(progress) = progress_rx.recv() {
                if forward_cancelled.load(Ordering::Acquire) || forward_emitter.progress(&progress).is_err() {
                    break;
                }
            }
        });

        let joined = tauri::async_runtime::spawn_blocking({
            let cancelled = cancelled.clone();
            move || {
                let mut progress_cb =
                    |progress: LocalTranscriptionProgress| progress_tx.send(progress).map_err(|error| error.to_string());
                let audio_path = resolve_asr_audio_path(
                    &app,
                    &request.audio_path,
                    request.isolate_vocals,
                    Some(&cancelled),
                    Some(&mut progress_cb),
                )?;
                crate::transcription::whisper_genai::transcribe_with_progress(
                    &app,
                    &audio_path,
                    request.language.as_deref(),
                    Some(&cancelled),
                    Some(&mut progress_cb),
                )
            }
        })
        .await;

        let _ = forward_handle.await;
        if !cancelled.load(Ordering::Acquire) {
            match joined {
                Ok(Ok(result)) => { let _ = emitter.result(&result); }
                Ok(Err(error)) => { let _ = emitter.error(&serde_json::json!({ "message": error, "fatal": true })); }
                Err(error) => { let _ = emitter.error(&serde_json::json!({ "message": format!("Whisper task join error: {error}"), "fatal": true })); }
            }
        }
        finish_registry.finish(&finish_session_id, &finish_job_id);
    });

    Ok(())
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
            let app_handle = app_handle.clone();
            let isolate_vocals = request.isolate_vocals;
            move || {
                let audio_path = {
                    let mut progress_cb = |progress: LocalTranscriptionProgress| {
                        progress_tx
                            .send(progress)
                            .map_err(|error| error.to_string())
                    };
                    resolve_asr_audio_path(
                        &app_handle,
                        &audio_path,
                        isolate_vocals,
                        Some(&cancelled),
                        Some(&mut progress_cb),
                    )
                    .map_err(TranscriptionError::Inference)?
                };
                service.transcribe_with_job(audio_path, cancelled, Some(progress_tx))
            }
        })
        .await;

        // `transcribe_with_job` emits the final `releasing` progress before
        // returning. Let the channel close naturally so that message reaches
        // the UI before the native result is delivered.
        let _ = forward_handle.await;

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
    });

    Ok(())
}

#[tauri::command]
pub async fn get_vocals_isolate_model_status(
    app: tauri::AppHandle,
) -> Result<VocalsIsolateModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || vocals_isolate::model_status(&app))
        .await
        .map_err(|error| format!("Demucs status task failed: {error}"))?
}

#[tauri::command]
pub fn delete_vocals_isolate_model(app: tauri::AppHandle) -> Result<(), String> {
    vocals_isolate::delete_model(&app)
}

#[tauri::command]
pub async fn download_vocals_isolate_model(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vocals_isolate::download_and_install_model(&app)
    })
    .await
    .map_err(|error| format!("Demucs download task failed: {error}"))?
    .map(|_| ())
}
