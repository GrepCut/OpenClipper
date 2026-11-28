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
    blocked_projects: HashSet<String>,
}

struct ActiveJob {
    session_id: String,
    cancelled: Arc<AtomicBool>,
    project_id: Option<String>,
    completion: tokio::sync::watch::Sender<()>,
}

pub(crate) struct ProjectJobBlock {
    registry: NativeJobRegistry,
    project_id: String,
}

impl Drop for ProjectJobBlock {
    fn drop(&mut self) {
        if let Ok(mut state) = self.registry.inner.lock() {
            state.blocked_projects.remove(&self.project_id);
        }
    }
}

fn message_can_be_sent(cancelled: bool, allow_cancelled: bool) -> bool {
    !cancelled || allow_cancelled
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

    pub fn register(&self, session_id: &str, job_id: &str) -> Result<Arc<AtomicBool>, String> {
        self.register_job(session_id, job_id, None)
    }

    #[cfg(windows)]
    pub(crate) fn register_project_job(
        &self,
        session_id: &str,
        job_id: &str,
        project_id: &str,
    ) -> Result<Arc<AtomicBool>, String> {
        self.register_job(session_id, job_id, Some(project_id))
    }

    fn register_job(
        &self,
        session_id: &str,
        job_id: &str,
        project_id: Option<&str>,
    ) -> Result<Arc<AtomicBool>, String> {
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
        if let Some(id) = project_id {
            if state.blocked_projects.contains(id)
                || state.jobs.values().any(|job| job.project_id.as_deref() == Some(id))
            {
                return Err("A project operation is already in progress".into());
            }
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        state.jobs.insert(
            job_id.to_string(),
            ActiveJob {
                session_id: session_id.to_string(),
                cancelled: cancelled.clone(),
                project_id: project_id.map(str::to_owned),
                completion: tokio::sync::watch::channel(()).0,
            },
        );
        Ok(cancelled)
    }

    pub(crate) async fn block_project(
        &self,
        project_id: &str,
        cancel: bool,
    ) -> Result<ProjectJobBlock, String> {
        let pending = {
            let mut state = self.inner.lock().map_err(|_| "Native job registry is poisoned")?;
            let job = state.jobs.values().find(|job| job.project_id.as_deref() == Some(project_id));
            let pending = match job {
                Some(job) if cancel => {
                    job.cancelled.store(true, Ordering::Release);
                    Some(job.completion.subscribe())
                }
                Some(_) => return Err("A project operation is already in progress".into()),
                None => None,
            };
            if !state.blocked_projects.insert(project_id.to_owned()) {
                return Err("A project operation is already in progress".into());
            }
            pending
        };
        let guard = ProjectJobBlock { registry: self.clone(), project_id: project_id.to_owned() };
        if let Some(mut done) = pending {
            let _ = done.changed().await;
        }
        Ok(guard)
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
        self.send(
            NativeJobMessage::Progress(
                serde_json::to_value(payload).map_err(|error| error.to_string())?,
            ),
            false,
        )
    }

    pub fn result<T: Serialize>(&self, payload: &T) -> Result<(), String> {
        self.send(
            NativeJobMessage::Result(
                serde_json::to_value(payload).map_err(|error| error.to_string())?,
            ),
            false,
        )
    }

    pub fn error<T: Serialize>(&self, payload: &T) -> Result<(), String> {
        self.send(
            NativeJobMessage::Error(
                serde_json::to_value(payload).map_err(|error| error.to_string())?,
            ),
            true,
        )
    }

    fn send(&self, message: NativeJobMessage, allow_cancelled: bool) -> Result<(), String> {
        if !message_can_be_sent(self.cancelled.load(Ordering::Acquire), allow_cancelled) {
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
    use super::message_can_be_sent;

    #[cfg(windows)]
    #[tokio::test]
    async fn project_deletion_cancels_and_waits_for_the_import_writer() {
        use super::{NativeJobRegistry, Ordering};
        use std::{future::{poll_fn, Future}, task::Poll};

        let jobs = NativeJobRegistry::default();
        jobs.activate_session("test-session").unwrap();
        let cancelled = jobs.register_project_job("test-session", "job", "project").unwrap();
        assert!(jobs.register_project_job("test-session", "other", "project").is_err());
        let mut deletion = std::pin::pin!(jobs.block_project("project", true));
        poll_fn(|context| {
            assert!(deletion.as_mut().poll(context).is_pending());
            Poll::Ready(())
        }).await;
        assert!(cancelled.load(Ordering::Acquire));
        jobs.finish("test-session", "job");
        let deletion_guard = deletion.await.unwrap();
        assert!(jobs.register_project_job("test-session", "other", "project").is_err());
        drop(deletion_guard);
        assert!(jobs.register_project_job("test-session", "other", "project").is_ok());
    }

    #[test]
    fn terminal_errors_can_be_sent_after_internal_cancellation() {
        assert!(message_can_be_sent(true, true));
        assert!(!message_can_be_sent(true, false));
        assert!(message_can_be_sent(false, false));
    }
}
