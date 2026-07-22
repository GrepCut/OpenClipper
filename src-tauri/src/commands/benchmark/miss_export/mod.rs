mod annotate;
mod commands;
mod ground_truth;
mod selection;
mod sync_export;
mod types;
use tauri::{AppHandle, State};

use crate::storage::database::LocalDb;

pub use commands::export_benchmark_run_miss_frames_inner;
pub use types::{ExportBenchmarkMissFramesResult, ExportBenchmarkRunMissFramesResult};

#[tauri::command]
pub async fn export_benchmark_miss_frames(
    app: AppHandle,
    db: State<'_, LocalDb>,
    result_id: String,
) -> Result<ExportBenchmarkMissFramesResult, String> {
    commands::export_benchmark_miss_frames(app, &db.database, result_id).await
}

#[tauri::command]
pub async fn export_benchmark_run_miss_frames(
    app: AppHandle,
    db: State<'_, LocalDb>,
    run_id: String,
) -> Result<ExportBenchmarkRunMissFramesResult, String> {
    export_benchmark_run_miss_frames_inner(&app, &db.database, &run_id, None).await
}
