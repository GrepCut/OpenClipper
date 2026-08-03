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
pub fn frontend_startup_log(
    level: String,
    message: String,
    details: Option<String>,
) -> Result<(), String> {
    let target = "frontend";
    match level.as_str() {
        "error" => {
            if let Some(details) = details {
                log::error!(target: target, "{message}: {details}");
            } else {
                log::error!(target: target, "{message}");
            }
        }
        "warn" => {
            if let Some(details) = details {
                log::warn!(target: target, "{message}: {details}");
            } else {
                log::warn!(target: target, "{message}");
            }
        }
        _ => {
            if let Some(details) = details {
                log::info!(target: target, "{message}: {details}");
            } else {
                log::info!(target: target, "{message}");
            }
        }
    }
    Ok(())
}
