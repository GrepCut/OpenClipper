use crate::cli::{finish_benchmark_cli, log_benchmark_progress, BenchmarkCliRequest, BenchmarkCliSummary, CliRequest};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_benchmark_cli_request(
    request: State<'_, Option<CliRequest>>,
) -> Option<BenchmarkCliRequest> {
    match request.inner() {
        Some(CliRequest::BenchmarkRun(value)) => Some(value.clone()),
        _ => None,
    }
}

#[tauri::command]
pub fn log_benchmark_cli_progress(message: String) {
    log_benchmark_progress(&message);
}

#[tauri::command]
pub fn finish_benchmark_cli_command(
    app: AppHandle,
    request: State<'_, Option<CliRequest>>,
    summary: BenchmarkCliSummary,
) {
    let (benchmark_request, json_output) = match request.inner() {
        Some(CliRequest::BenchmarkRun(value)) => (Some(value.clone()), value.json_output),
        _ => (None, false),
    };
    finish_benchmark_cli(&app, benchmark_request.as_ref(), summary, json_output);
}
