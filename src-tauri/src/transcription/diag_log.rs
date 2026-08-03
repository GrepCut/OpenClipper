//! Append-only diagnostic log for the transcription pipeline (Downloads).
//! Kept intentionally sparse — only critical milestones and errors.

use serde_json::{json, Value};
use std::fs;
use std::sync::Mutex;

const LOG_FILE_NAME: &str = "open-clipper-transcription.json";
const MAX_ENTRIES: usize = 120;

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn log_path() -> Option<std::path::PathBuf> {
    dirs::download_dir().map(|mut path| {
        path.push(LOG_FILE_NAME);
        path
    })
}

pub fn append(stage: &str, details: Value) {
    let Ok(_guard) = LOG_LOCK.lock() else {
        return;
    };
    let Some(path) = log_path() else {
        return;
    };

    let entry = json!({
        "timestamp": chrono::Local::now().to_rfc3339(),
        "stage": stage,
        "details": details,
    });

    if stage.ends_with("_ERROR") {
        log::warn!(
            "[TranscriptionDiag] [{stage}] {}",
            serde_json::to_string(&details).unwrap_or_default()
        );
    }

    let mut logs: Vec<Value> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    logs.push(entry);
    if logs.len() > MAX_ENTRIES {
        let drop_count = logs.len() - MAX_ENTRIES;
        logs.drain(0..drop_count);
    }

    if let Ok(formatted) = serde_json::to_string_pretty(&logs) {
        let _ = fs::write(path, formatted);
    }
}

pub fn append_error(step: &str, error: impl AsRef<str>, extra: Value) {
    let mut details = match extra {
        Value::Object(map) => Value::Object(map),
        other => json!({ "context": other }),
    };
    if let Some(obj) = details.as_object_mut() {
        obj.insert("step".into(), Value::String(step.into()));
        obj.insert("error".into(), Value::String(error.as_ref().into()));
    }
    append("TRANSCRIBE_ERROR", details);
}

#[tauri::command]
pub fn append_transcription_diag_log(stage: String, details: Value) {
    append(&stage, details);
}
