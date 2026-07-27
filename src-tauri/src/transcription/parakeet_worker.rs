use super::model_manager::{is_model_installed, resolve_model_dir};
use super::parakeet_probe::{default_thread_count, load_preferred, select_provider};
use super::types::{
    ParakeetTranscriptionProgress, ParakeetTranscriptionResult, TranscriptionError,
};
use crossbeam_channel::{Receiver, Sender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::AppHandle;

struct ParakeetJob {
    audio_path: String,
    cancelled: Arc<AtomicBool>,
    progress_tx: Option<Sender<ParakeetTranscriptionProgress>>,
    response: Sender<Result<ParakeetTranscriptionResult, String>>,
}

enum WorkerState {
    Unloaded,
    Ready {
        job_tx: Sender<ParakeetJob>,
        handle: JoinHandle<()>,
    },
}

pub struct ParakeetService {
    pub app: AppHandle,
    num_threads: i32,
    state: Mutex<WorkerState>,
    /// Parakeet owns a sizeable DirectML session. Only one job may hold that
    /// session, from construction through deterministic teardown.
    transcription_gate: Mutex<()>,
    loaded: AtomicBool,
    provider_name: Mutex<Option<String>>,
}

impl ParakeetService {
    pub fn new(app: AppHandle) -> Arc<Self> {
        super::directml_adapter::configure_preferred_adapter();
        Arc::new(Self {
            app,
            num_threads: default_thread_count(),
            state: Mutex::new(WorkerState::Unloaded),
            transcription_gate: Mutex::new(()),
            loaded: AtomicBool::new(false),
            provider_name: Mutex::new(None),
        })
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded.load(Ordering::Acquire)
    }

    pub fn active_provider(&self) -> Option<String> {
        self.provider_name
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    pub fn ensure_worker(&self) -> Result<(), TranscriptionError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| TranscriptionError::ModelLoad("Worker lock poisoned".into()))?;

        match &*state {
            WorkerState::Ready { .. } => return Ok(()),
            WorkerState::Unloaded => {}
        }

        let model_dir = resolve_model_dir(&self.app).map_err(TranscriptionError::ModelLoad)?;
        if !is_model_installed(&model_dir) {
            return Err(TranscriptionError::ModelNotInstalled);
        }

        let (provider, provider_name) = load_preferred(&model_dir, self.num_threads)?;
        let (job_tx, job_rx): (Sender<ParakeetJob>, Receiver<ParakeetJob>) =
            crossbeam_channel::unbounded();

        let handle = thread::Builder::new()
            .name("parakeet-worker".into())
            .spawn(move || {
                while let Ok(job) = job_rx.recv() {
                    let mut progress_callback = job.progress_tx.map(|sender| {
                        move |progress: ParakeetTranscriptionProgress| {
                            sender
                                .send(progress)
                                .map_err(|_| "Progress channel closed".to_string())
                        }
                    });

                    let result = provider.transcribe_wav_with_progress(
                        &job.audio_path,
                        Some(job.cancelled.as_ref()),
                        progress_callback.as_mut(),
                    );
                    let mapped = result.map_err(|error| error.to_string());
                    let _ = job.response.send(mapped);
                }
            })
            .map_err(|error| {
                TranscriptionError::ModelLoad(format!("Worker spawn failed: {error}"))
            })?;

        if let Ok(mut active_provider) = self.provider_name.lock() {
            *active_provider = Some(provider_name.clone());
        }

        *state = WorkerState::Ready { job_tx, handle };
        self.loaded.store(true, Ordering::Release);
        Ok(())
    }

    pub fn probe_capability(&self) -> Result<(bool, Option<String>, bool), TranscriptionError> {
        let model_dir = resolve_model_dir(&self.app).map_err(TranscriptionError::ModelLoad)?;
        let installed = is_model_installed(&model_dir);
        if !installed {
            return Ok((false, None, false));
        }

        let (provider, already_smoked) = select_provider(&model_dir, self.num_threads);
        let available = if already_smoked {
            true
        } else {
            super::parakeet_probe::smoke_provider(&model_dir, &provider, self.num_threads)
        };
        Ok((available, Some(provider), true))
    }

    pub fn transcribe(
        &self,
        audio_path: String,
    ) -> Result<ParakeetTranscriptionResult, TranscriptionError> {
        self.transcribe_with_job(audio_path, Arc::new(AtomicBool::new(false)), None)
    }

    pub fn transcribe_with_job(
        &self,
        audio_path: String,
        cancelled: Arc<AtomicBool>,
        progress_tx: Option<Sender<ParakeetTranscriptionProgress>>,
    ) -> Result<ParakeetTranscriptionResult, TranscriptionError> {
        let _gate = self
            .transcription_gate
            .lock()
            .map_err(|_| TranscriptionError::Inference("Transcription lock poisoned".into()))?;
        emit_loading_progress(&progress_tx, 0.0, None);
        self.ensure_worker()?;
        let provider_name = self.active_provider();
        emit_loading_progress(&progress_tx, 1.0, provider_name.clone());

        let result = (|| {
            let job_tx = {
                let state = self
                    .state
                    .lock()
                    .map_err(|_| TranscriptionError::ModelLoad("Worker lock poisoned".into()))?;
                match &*state {
                    WorkerState::Ready { job_tx, .. } => job_tx.clone(),
                    WorkerState::Unloaded => {
                        return Err(TranscriptionError::ModelLoad(
                            "Worker Parakeet nie jest gotowy".into(),
                        ));
                    }
                }
            };

            let (response_tx, response_rx) = crossbeam_channel::bounded(1);
            job_tx
                .send(ParakeetJob {
                    audio_path,
                    cancelled,
                    progress_tx: progress_tx.clone(),
                    response: response_tx,
                })
                .map_err(|_| {
                    TranscriptionError::Inference("Worker Parakeet nie odpowiada".into())
                })?;

            response_rx
                .recv_timeout(Duration::from_secs(3600))
                .map_err(|_| TranscriptionError::Inference("Timeout transkrypcji".into()))?
                .map_err(TranscriptionError::Inference)
        })();

        // The recognizer is owned by the worker. Closing its sender and
        // joining the thread makes Rust drop it before we return to the UI,
        // releasing ONNX Runtime / DirectML resources instead of retaining
        // VRAM for the rest of the app session.
        emit_releasing_progress(&progress_tx, 0.0, provider_name.clone());
        self.unload_worker();
        emit_releasing_progress(&progress_tx, 1.0, provider_name);
        result
    }

    pub fn unload(&self) {
        let Ok(_gate) = self.transcription_gate.lock() else {
            return;
        };
        self.unload_worker();
    }

    fn unload_worker(&self) {
        let worker = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            std::mem::replace(&mut *state, WorkerState::Unloaded)
        };
        if let WorkerState::Ready { job_tx, handle } = worker {
            drop(job_tx);
            if handle.join().is_err() {
                log::warn!("Parakeet worker stopped after a panic");
            }
        }
        self.loaded.store(false, Ordering::Release);
    }
}

fn emit_loading_progress(
    progress_tx: &Option<Sender<ParakeetTranscriptionProgress>>,
    ratio: f64,
    provider: Option<String>,
) {
    if let Some(tx) = progress_tx {
        let _ = tx.send(ParakeetTranscriptionProgress {
            phase: "loading".into(),
            chunk_index: 0,
            chunk_count: 0,
            ratio,
            provider,
        });
    }
}

fn emit_releasing_progress(
    progress_tx: &Option<Sender<ParakeetTranscriptionProgress>>,
    ratio: f64,
    provider: Option<String>,
) {
    if let Some(tx) = progress_tx {
        let _ = tx.send(ParakeetTranscriptionProgress {
            phase: "releasing".into(),
            chunk_index: 0,
            chunk_count: 0,
            ratio,
            provider,
        });
    }
}
