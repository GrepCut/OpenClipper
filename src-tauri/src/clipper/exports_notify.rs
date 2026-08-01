use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

pub const CLIPPER_EXPORTS_CHANGED_EVENT: &str = "clipper-exports-changed";

pub const EXPORTS_CHANGED_REASON_UPSERT: &str = "upsert";
pub const EXPORTS_CHANGED_REASON_PATCH_SOCIAL: &str = "patch_social";
pub const EXPORTS_CHANGED_REASON_PUBLISH: &str = "publish";
pub const EXPORTS_CHANGED_REASON_DELETE: &str = "delete";
pub const EXPORTS_CHANGED_REASON_MCP: &str = "mcp";

static NOTIFY_TX: OnceLock<mpsc::UnboundedSender<ClipperExportsChangedEvent>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportsChangedEvent {
    pub project_id: Option<String>,
    pub export_id: Option<String>,
    pub reason: String,
}

impl ClipperExportsChangedEvent {
    pub fn new(
        project_id: Option<String>,
        export_id: Option<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            project_id,
            export_id,
            reason: reason.into(),
        }
    }
}

pub fn spawn_exports_notify_listener(app: AppHandle) {
    let (tx, mut rx) = mpsc::unbounded_channel::<ClipperExportsChangedEvent>();
    let _ = NOTIFY_TX.set(tx);
    tauri::async_runtime::spawn(async move {
        while let Some(detail) = rx.recv().await {
            emit_exports_changed(&app, detail);
        }
    });
}

pub fn enqueue_exports_changed(detail: ClipperExportsChangedEvent) {
    if let Some(tx) = NOTIFY_TX.get() {
        let _ = tx.send(detail);
    }
}

pub fn emit_exports_changed(app: &AppHandle, detail: ClipperExportsChangedEvent) {
    let _ = app.emit(CLIPPER_EXPORTS_CHANGED_EVENT, detail);
}

pub fn exports_changed_notify_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp/internal/exports-changed")
}

/// Fire-and-forget HTTP ping used by the stdio MCP binary (separate process).
pub fn notify_exports_changed_http(detail: ClipperExportsChangedEvent) {
    let port = crate::mcp::resolve_mcp_http_port();
    let url = exports_changed_notify_url(port);
    std::thread::spawn(move || {
        let _ = reqwest::blocking::Client::new()
            .post(url)
            .json(&detail)
            .send();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_serializes_camel_case() {
        let event = ClipperExportsChangedEvent::new(
            Some("project-1".to_string()),
            Some("export-1".to_string()),
            EXPORTS_CHANGED_REASON_MCP,
        );
        let json = serde_json::to_value(&event).expect("serialize");
        assert_eq!(json["projectId"], "project-1");
        assert_eq!(json["exportId"], "export-1");
        assert_eq!(json["reason"], "mcp");
    }

    #[test]
    fn notify_url_uses_resolved_port() {
        let url = exports_changed_notify_url(12742);
        assert_eq!(url, "http://127.0.0.1:12742/mcp/internal/exports-changed");
    }
}
