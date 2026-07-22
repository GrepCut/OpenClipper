use std::fmt;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::args::{
    BenchmarkCliRequest, BenchmarkCliSummary, ExtractMissFramesCliRequest,
    ExtractMissFramesCliSummary,
};
use crate::commands::benchmark::miss_export::{
    export_benchmark_run_miss_frames_inner, ExportBenchmarkRunMissFramesResult,
};

pub fn stdout_line(args: impl fmt::Display) {
    let _ = writeln!(io::stdout().lock(), "{args}");
}

pub fn stderr_line(args: impl fmt::Display) {
    let _ = writeln!(io::stderr().lock(), "{args}");
}

macro_rules! println {
    () => {
        stdout_line("")
    };
    ($($arg:tt)*) => {
        stdout_line(format_args!($($arg)*))
    };
}

macro_rules! eprintln {
    ($($arg:tt)*) => {
        stderr_line(format_args!($($arg)*))
    };
}

pub async fn ensure_dataset_exists(
    app: &AppHandle,
    dataset_id: &str,
) -> Result<crate::storage::entity::test_dataset::Model, String> {
    super::args::validate_dataset_dir(app, dataset_id);
    let db = app.state::<crate::storage::database::LocalDb>();
    crate::storage::repository::test_repository::TestRepository::get_dataset(
        &db.database,
        dataset_id,
    )
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("Test dataset {dataset_id} was not found in the local database."))
}

pub async fn run_extract_miss_frames_cli(
    app: &AppHandle,
    request: &ExtractMissFramesCliRequest,
) -> Result<ExportBenchmarkRunMissFramesResult, String> {
    let db = app.state::<crate::storage::database::LocalDb>();
    export_benchmark_run_miss_frames_inner(
        app,
        &db.database,
        &request.run_id,
        request.output_dir.clone(),
    )
    .await
}

pub fn print_cli_start(request: &BenchmarkCliRequest, dataset_name: &str) {
    println!(
        "Starting benchmark for dataset \"{dataset_name}\" ({})",
        request.dataset_id
    );
    if request.extract_miss_frames {
        println!("Miss-frame export will run after the benchmark completes.");
    }
}

pub fn print_extract_start(request: &ExtractMissFramesCliRequest) {
    println!("Exporting miss frames for run {}", request.run_id);
    if let Some(path) = &request.output_dir {
        println!("Output directory: {}", path.display());
    }
}

pub fn log_benchmark_progress(message: &str) {
    println!("{message}");
}

pub fn finish_extract_miss_frames_cli(
    app: &AppHandle,
    request: &ExtractMissFramesCliRequest,
    result: Result<ExportBenchmarkRunMissFramesResult, String>,
) {
    match result {
        Ok(export) => {
            let manifest_path = Path::new(&export.export_dir).join("manifest.json");
            let summary = ExtractMissFramesCliSummary {
                run_id: request.run_id.clone(),
                export_dir: export.export_dir.clone(),
                frame_count: export.frame_count,
                result_count: export.result_count,
                manifest_path: manifest_path.display().to_string(),
            };
            if request.json_output {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&summary).unwrap_or_else(|error| {
                        format!("{{\"error\":\"Failed to serialize summary: {error}\"}}")
                    })
                );
            } else {
                print_extract_human_summary(&summary);
            }
            app.exit(0);
        }
        Err(error) => {
            if request.json_output {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "runId": request.run_id,
                        "error": error,
                    }))
                    .unwrap_or_else(|_| format!("{{\"error\":\"{error}\"}}"))
                );
            } else {
                eprintln!("Error: {error}");
            }
            app.exit(1);
        }
    }
}

fn print_extract_human_summary(summary: &ExtractMissFramesCliSummary) {
    println!();
    println!("Miss frames exported for run {}", summary.run_id);
    println!("Directory: {}", summary.export_dir);
    println!(
        "Frames: {} from {} clip/aspect result(s)",
        summary.frame_count, summary.result_count
    );
    println!("Manifest: {}", summary.manifest_path);
}

pub fn finish_benchmark_cli(
    app: &AppHandle,
    request: Option<&BenchmarkCliRequest>,
    mut summary: BenchmarkCliSummary,
    json_output: bool,
) {
    resolve_manifest_path(app, &mut summary);
    if summary.status == "completed"
        && request.is_some_and(|value| value.extract_miss_frames)
        && !summary.run_id.is_empty()
    {
        match tauri::async_runtime::block_on(run_extract_miss_frames_for_run(
            app,
            &summary.run_id,
            None,
        )) {
            Ok(export) => {
                summary.miss_frames_export_dir = Some(export.export_dir);
                summary.miss_frames_count = Some(export.frame_count);
            }
            Err(error) => {
                summary.error = Some(format!(
                    "{}{}",
                    summary
                        .error
                        .map(|value| format!("{value}; "))
                        .unwrap_or_default(),
                    format!("miss-frame export failed: {error}")
                ));
            }
        }
    }

    let success = summary.status == "completed" && summary.error.is_none();
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&summary).unwrap_or_else(|error| {
                format!("{{\"error\":\"Failed to serialize summary: {error}\"}}")
            })
        );
    } else {
        print_human_summary(&summary);
    }
    let code = if success { 0 } else { 1 };
    app.exit(code);
}

async fn run_extract_miss_frames_for_run(
    app: &AppHandle,
    run_id: &str,
    output_dir: Option<PathBuf>,
) -> Result<ExportBenchmarkRunMissFramesResult, String> {
    let db = app.state::<crate::storage::database::LocalDb>();
    export_benchmark_run_miss_frames_inner(app, &db.database, run_id, output_dir).await
}

fn print_human_summary(summary: &BenchmarkCliSummary) {
    println!();
    println!("Benchmark {} ({})", summary.status, summary.run_id);
    println!("Dataset: {} ({})", summary.dataset_name, summary.dataset_id);
    println!(
        "Clips: {} completed, {} failed",
        summary.completed_clips, summary.failed_clips
    );
    if let Some(error) = &summary.error {
        println!("Run error: {error}");
    }
    if let Some(path) = &summary.manifest_path {
        println!("Manifest: {path}");
    }
    if let Some(path) = &summary.miss_frames_export_dir {
        let count = summary.miss_frames_count.unwrap_or(0);
        println!("Miss frames: {count} JPEG(s) in {path}");
    }
    for clip in &summary.clips {
        if clip.aspects.is_empty() {
            println!(
                "- {} [{}] {}",
                clip.clip_name,
                clip.status,
                clip.error.as_deref().unwrap_or("no aspect results")
            );
            continue;
        }
        for aspect in &clip.aspects {
            let coverage_hit = aspect
                .coverage_hit_rate
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            let median_cov = aspect
                .median_coverage_fraction
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            let coverage = aspect
                .mean_coverage_fraction
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            let dual_covered = aspect
                .dual_target_all_covered_rate
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            println!(
                "- {} {} coverageHit={coverage_hit} coverage={coverage} dualCovered={dual_covered} medianCov={median_cov} [{}]",
                clip.clip_name, aspect.aspect_id, aspect.status
            );
            if let Some(error) = &aspect.error {
                println!("    {error}");
            }
        }
    }
}

fn resolve_manifest_path(app: &AppHandle, summary: &mut BenchmarkCliSummary) {
    if summary.manifest_path.is_some() || summary.run_id.is_empty() {
        return;
    }
    let Ok(root) = app.path().app_data_dir() else {
        return;
    };
    let path = root
        .join("test-datasets")
        .join(&summary.dataset_id)
        .join("runs")
        .join(&summary.run_id)
        .join("manifest.json");
    if path.is_file() {
        summary.manifest_path = Some(path.display().to_string());
    }
}
