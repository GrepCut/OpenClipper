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
