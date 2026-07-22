use crate::infra::startup_log;
use crate::video::jobs::registry::NativeJobRegistry;
use tauri::State;

#[tauri::command]
pub fn frontend_ready(
    session_id: String,
    jobs: State<'_, NativeJobRegistry>,
) -> Result<(), String> {
    log::info!(target: "frontend", "frontend_ready received; session_id={session_id}");
    let retired = jobs.activate_session(&session_id)?;
    let _ = retired;
    Ok(())
}

#[tauri::command]
pub fn frontend_startup_log(level: String, message: String, details: Option<String>) {
    let message = match details {
        Some(details) if !details.is_empty() => format!("{message}; details={details}"),
        _ => message,
    };
    let message = format!("{message}; {}", startup_log::context());

    match level.as_str() {
        "error" => log::error!(target: "frontend", "{message}"),
        "warn" => log::warn!(target: "frontend", "{message}"),
        "debug" => log::debug!(target: "frontend", "{message}"),
        _ => log::info!(target: "frontend", "{message}"),
    }
}
