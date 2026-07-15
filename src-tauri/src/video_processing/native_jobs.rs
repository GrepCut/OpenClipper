use serde::Serialize;
use serialize_to_javascript::{Options, Serialized};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::WebviewWindow;

#[derive(Clone)]
pub struct NativeJobRegistry {
    inner: Arc<Mutex<RegistryState>>,
}

#[derive(Default)]
struct RegistryState {
    active_session: Option<String>,
    jobs: HashMap<String, ActiveJob>,
}

struct ActiveJob {
    session_id: String,
    cancelled: Arc<AtomicBool>,
}

impl Default for NativeJobRegistry {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryState::default())),
        }
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

impl NativeJobRegistry {
    pub fn activate_session(&self, session_id: &str) -> Result<Vec<String>, String> {
        if !valid_identifier(session_id) {
            return Err("Invalid frontend session id".into());
        }
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Native job registry is poisoned")?;
        if state.active_session.as_deref() == Some(session_id) {
            return Ok(Vec::new());
        }

        let mut retired = HashSet::new();
        for job in state.jobs.values() {
            if job.session_id != session_id {
                job.cancelled.store(true, Ordering::Release);
                retired.insert(job.session_id.clone());
            }
        }
        if let Some(previous) = state.active_session.replace(session_id.to_string()) {
            if previous != session_id {
                retired.insert(previous);
            }
        }
        Ok(retired.into_iter().collect())
    }

    pub fn retire_active_session(&self) -> Vec<String> {
        let Ok(mut state) = self.inner.lock() else {
            return Vec::new();
        };
        let Some(session_id) = state.active_session.take() else {
            return Vec::new();
        };
        for job in state.jobs.values() {
            if job.session_id == session_id {
                job.cancelled.store(true, Ordering::Release);
            }
        }
        vec![session_id]
    }

    pub fn register(&self, session_id: &str, job_id: &str) -> Result<Arc<AtomicBool>, String> {
        if !valid_identifier(session_id) || !valid_identifier(job_id) {
            return Err("Invalid native job identifier".into());
        }
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Native job registry is poisoned")?;
        if state.active_session.as_deref() != Some(session_id) {
            return Err("Frontend session is no longer active".into());
        }
        if state.jobs.contains_key(job_id) {
            return Err("Native job id is already active".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        state.jobs.insert(
            job_id.to_string(),
            ActiveJob {
                session_id: session_id.to_string(),
                cancelled: cancelled.clone(),
            },
        );
        Ok(cancelled)
    }

    pub fn cancel(&self, session_id: &str, job_id: &str) -> bool {
        let Ok(state) = self.inner.lock() else {
            return false;
        };
        state
            .jobs
            .get(job_id)
            .filter(|job| job.session_id == session_id)
            .map(|job| {
                job.cancelled.store(true, Ordering::Release);
                true
            })
            .unwrap_or(false)
    }

    pub fn finish(&self, session_id: &str, job_id: &str) {
        if let Ok(mut state) = self.inner.lock() {
            if state
                .jobs
                .get(job_id)
                .is_some_and(|job| job.session_id == session_id)
            {
                state.jobs.remove(job_id);
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeJobEnvelope {
    session_id: String,
    job_id: String,
    sequence: usize,
    message: NativeJobMessage,
}

#[derive(Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
enum NativeJobMessage {
    Progress(serde_json::Value),
    Result(serde_json::Value),
    Error(serde_json::Value),
}

#[derive(Clone)]
pub struct NativeJobEmitter {
    webview: WebviewWindow,
    session_id: String,
    job_id: String,
    sequence: Arc<AtomicUsize>,
    cancelled: Arc<AtomicBool>,
}

impl NativeJobEmitter {
    pub fn new(
        webview: WebviewWindow,
        session_id: String,
        job_id: String,
        cancelled: Arc<AtomicBool>,
    ) -> Self {
        Self {
            webview,
            session_id,
            job_id,
            sequence: Arc::new(AtomicUsize::new(0)),
            cancelled,
        }
    }

    pub fn progress<T: Serialize>(&self, payload: &T) -> Result<(), String> {
        self.send(NativeJobMessage::Progress(
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        ))
    }

    pub fn result<T: Serialize>(&self, payload: &T) -> Result<(), String> {
        self.send(NativeJobMessage::Result(
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        ))
    }

    pub fn error<T: Serialize>(&self, payload: &T) -> Result<(), String> {
        self.send(NativeJobMessage::Error(
            serde_json::to_value(payload).map_err(|error| error.to_string())?,
        ))
    }

    fn send(&self, message: NativeJobMessage) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err("Native job was cancelled".into());
        }
        let envelope = NativeJobEnvelope {
            session_id: self.session_id.clone(),
            job_id: self.job_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            message,
        };
        let raw = serde_json::value::to_raw_value(&envelope).map_err(|error| error.to_string())?;
        let serialized = Serialized::new(&raw, &Options::default());
        let script = format!(
            "window.__OPEN_CLIPPER_NATIVE_JOB_DISPATCH__?.({})",
            serialized.into_string()
        );
        self.webview.eval(script).map_err(|error| {
            self.cancelled.store(true, Ordering::Release);
            error.to_string()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_session_activation_is_idempotent() {
        let registry = NativeJobRegistry::default();
        assert!(registry
            .activate_session("frontend-one")
            .unwrap()
            .is_empty());
        let cancelled = registry.register("frontend-one", "job-one").unwrap();
        assert!(registry
            .activate_session("frontend-one")
            .unwrap()
            .is_empty());
        assert!(!cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn session_rollover_cancels_old_jobs() {
        let registry = NativeJobRegistry::default();
        registry.activate_session("frontend-one").unwrap();
        let cancelled = registry.register("frontend-one", "job-one").unwrap();
        let retired = registry.activate_session("frontend-two").unwrap();
        assert!(retired.iter().any(|value| value == "frontend-one"));
        assert!(cancelled.load(Ordering::Acquire));
        assert!(registry.register("frontend-one", "job-two").is_err());
        assert!(registry.register("frontend-two", "job-two").is_ok());
    }

    #[test]
    fn cancellation_is_scoped_to_the_owner() {
        let registry = NativeJobRegistry::default();
        registry.activate_session("frontend-one").unwrap();
        let cancelled = registry.register("frontend-one", "job-one").unwrap();
        assert!(!registry.cancel("frontend-other", "job-one"));
        assert!(!cancelled.load(Ordering::Acquire));
        assert!(registry.cancel("frontend-one", "job-one"));
        assert!(cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn duplicate_and_unsafe_identifiers_are_rejected() {
        let registry = NativeJobRegistry::default();
        registry.activate_session("frontend-one").unwrap();
        registry.register("frontend-one", "job-one").unwrap();
        assert!(registry.register("frontend-one", "job-one").is_err());
        assert!(registry.register("frontend-one", "../job").is_err());
    }
}
