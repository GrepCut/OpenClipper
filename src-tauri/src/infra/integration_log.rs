use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Datelike;

const LOG_FILE_PREFIX: &str = "integrations-";

fn validate_log_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || !file_name.starts_with(LOG_FILE_PREFIX)
        || !file_name.ends_with(".log")
    {
        return Err(format!("Invalid integration log file name: {file_name}"));
    }
    Ok(())
}

fn resolve_integration_log_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("INTEGRATION_LOGS_DIR") {
        return PathBuf::from(dir);
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cwd.ends_with("src-tauri") {
            if let Some(open_clipper_dir) = cwd.parent() {
                if let Some(repo_root) = open_clipper_dir.parent() {
                    return repo_root.join("logs").join("integrations");
                }
            }
        }

        if cwd.file_name().and_then(|name| name.to_str()) == Some("open-clipper") {
            if let Some(repo_root) = cwd.parent() {
                return repo_root.join("logs").join("integrations");
            }
        }
    }

    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("open-clipper")
        .join("logs")
        .join("integrations")
}

fn daily_log_file_name() -> String {
    let now = chrono::Local::now();
    format!(
        "{LOG_FILE_PREFIX}{year:04}-{month:02}-{day:02}.log",
        year = now.year(),
        month = now.month(),
        day = now.day(),
    )
}

fn append_to_log_dir(log_dir: &Path, file_name: &str, content: &str) -> Result<String, String> {
    validate_log_file_name(file_name)?;
    fs::create_dir_all(log_dir)
        .map_err(|error| format!("Failed to create integration log directory: {error}"))?;

    let log_path = log_dir.join(file_name);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Failed to open integration log file: {error}"))?;

    file.write_all(content.as_bytes())
        .map_err(|error| format!("Failed to write integration log file: {error}"))?;

    Ok(log_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn append_integration_log(content: String) -> Result<String, String> {
    let log_dir = resolve_integration_log_dir();
    append_to_log_dir(&log_dir, &daily_log_file_name(), &content)
}
