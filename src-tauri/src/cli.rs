use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

use crate::commands::test_benchmark::benchmark_miss_export::{
    export_benchmark_run_miss_frames_inner, ExportBenchmarkRunMissFramesResult,
};

// A detached Windows GUI process can outlive the shell that launched it.  The
// standard println!/eprintln! macros panic when that shell closes its pipe,
// which used to abort an otherwise healthy headless benchmark.  CLI output is
// best-effort, so deliberately ignore a broken stdout/stderr here.
fn write_stdout_line(args: fmt::Arguments<'_>) {
    let _ = writeln!(io::stdout().lock(), "{args}");
}

fn write_stderr_line(args: fmt::Arguments<'_>) {
    let _ = writeln!(io::stderr().lock(), "{args}");
}

macro_rules! println {
    () => {
        write_stdout_line(format_args!(""))
    };
    ($($arg:tt)*) => {
        write_stdout_line(format_args!($($arg)*))
    };
}

macro_rules! eprintln {
    ($($arg:tt)*) => {
        write_stderr_line(format_args!($($arg)*))
    };
}

static BENCHMARK_CLI_ACTIVE: AtomicBool = AtomicBool::new(false);

const HELP: &str = "\
Open Clipper benchmark CLI

Usage:
  open-clipper --benchmark-run <dataset-id-or-path> [--json] [--extract-miss-frames]
  open-clipper --extract-miss-frames <run-id> [--output <dir>] [--json]

Options:
  --benchmark-run <id-or-path>  Run annotated clips in a test dataset headlessly
  --extract-miss-frames <run-id>  Export worst keyframe JPEGs for a completed run
  --extract-miss-frames           With --benchmark-run: export after the run finishes
  --output <dir>                  Custom flat export directory (extract mode only)
  --json                          Print machine-readable JSON summary to stdout
  --help, -h                      Show this help

Examples:
  open-clipper --benchmark-run cd986c2a-d998-4a96-afec-218d052d8c78
  open-clipper --benchmark-run cd986c2a-... --extract-miss-frames
  open-clipper --extract-miss-frames a1b2c3d4-e5f6-7890-abcd-ef1234567890
  open-clipper --extract-miss-frames a1b2c3d4-... --output C:\\temp\\miss-frames
";

#[derive(Clone, Debug)]
pub enum CliRequest {
    BenchmarkRun(BenchmarkCliRequest),
    ExtractMissFrames(ExtractMissFramesCliRequest),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliRequest {
    pub dataset_id: String,
    pub json_output: bool,
    pub extract_miss_frames: bool,
}

#[derive(Clone, Debug)]
pub struct ExtractMissFramesCliRequest {
    pub run_id: String,
    pub output_dir: Option<PathBuf>,
    pub json_output: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliClipSummary {
    pub clip_id: String,
    pub clip_name: String,
    pub status: String,
    pub aspects: Vec<BenchmarkCliAspectSummary>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliAspectSummary {
    pub aspect_id: String,
    pub status: String,
    pub focus_hit_rate: Option<f64>,
    pub target_visibility_rate: Option<f64>,
    pub dual_target_all_visible_rate: Option<f64>,
    pub layout_mode_rates: Option<HashMap<String, f64>>,
    pub mean_focus_error_radius: Option<f64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliSummary {
    pub dataset_id: String,
    pub dataset_name: String,
    pub run_id: String,
    pub status: String,
    pub completed_clips: usize,
    pub failed_clips: usize,
    pub manifest_path: Option<String>,
    pub miss_frames_export_dir: Option<String>,
    pub miss_frames_count: Option<usize>,
    pub error: Option<String>,
    pub clips: Vec<BenchmarkCliClipSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractMissFramesCliSummary {
    pub run_id: String,
    pub export_dir: String,
    pub frame_count: usize,
    pub result_count: usize,
    pub manifest_path: String,
}

pub fn parse_args() -> Option<CliRequest> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return None;
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print_help();
        std::process::exit(0);
    }

    let mut dataset_id: Option<String> = None;
    let mut extract_run_id: Option<String> = None;
    let mut extract_after_benchmark = false;
    let mut output_dir: Option<PathBuf> = None;
    let mut json_output = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--benchmark-run" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    exit_with_error(2, "--benchmark-run requires a dataset id or path");
                };
                dataset_id = Some(normalize_dataset_arg(value));
            }
            "--extract-miss-frames" => {
                if let Some(next) = args.get(index + 1).filter(|value| !value.starts_with('-')) {
                    extract_run_id = Some(next.clone());
                    index += 1;
                } else {
                    extract_after_benchmark = true;
                }
            }
            "--output" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    exit_with_error(2, "--output requires a directory path");
                };
                output_dir = Some(PathBuf::from(value));
            }
            "--json" => json_output = true,
            unknown => exit_with_error(2, &format!("Unknown argument: {unknown}")),
        }
        index += 1;
    }

    if let Some(run_id) = extract_run_id {
        if dataset_id.is_some() {
            exit_with_error(
                2,
                "Use either --benchmark-run or --extract-miss-frames <run-id>, not both.",
            );
        }
        BENCHMARK_CLI_ACTIVE.store(true, Ordering::SeqCst);
        return Some(CliRequest::ExtractMissFrames(ExtractMissFramesCliRequest {
            run_id,
            output_dir,
            json_output,
        }));
    }

    let Some(dataset_id) = dataset_id else {
        return None;
    };

    BENCHMARK_CLI_ACTIVE.store(true, Ordering::SeqCst);
    Some(CliRequest::BenchmarkRun(BenchmarkCliRequest {
        dataset_id,
        json_output,
        extract_miss_frames: extract_after_benchmark,
    }))
}

pub fn is_benchmark_cli_argv(argv: &[String]) -> bool {
    argv.iter().any(|arg| arg == "--benchmark-run" || arg == "--extract-miss-frames")
}

fn normalize_dataset_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        exit_with_error(2, "Dataset id or path must not be empty.");
    }
    let path = Path::new(trimmed);
    if path.is_dir() || trimmed.contains('\\') || trimmed.contains('/') {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| {
                exit_with_error(2, "Could not resolve a dataset id from the provided path.")
            })
    } else {
        trimmed.to_string()
    }
}

pub fn validate_dataset_dir(app: &AppHandle, dataset_id: &str) -> PathBuf {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data directory: {error}"))
        .unwrap_or_else(|message| exit_with_error(2, &message));
    let dataset_dir = root.join("test-datasets").join(dataset_id);
    if !dataset_dir.is_dir() {
        exit_with_error(
            2,
            &format!(
                "Test dataset directory was not found: {}",
                dataset_dir.display()
            ),
        );
    }
    dataset_dir
}

pub async fn ensure_dataset_exists(
    app: &AppHandle,
    dataset_id: &str,
) -> Result<crate::entity::test_dataset::Model, String> {
    validate_dataset_dir(app, dataset_id);
    let db = app.state::<crate::database::LocalDb>();
    crate::repository::test_repository::TestRepository::get_dataset(&db.database, dataset_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Test dataset {dataset_id} was not found in the local database."))
}

pub async fn run_extract_miss_frames_cli(
    app: &AppHandle,
    request: &ExtractMissFramesCliRequest,
) -> Result<ExportBenchmarkRunMissFramesResult, String> {
    let db = app.state::<crate::database::LocalDb>();
    export_benchmark_run_miss_frames_inner(
        app,
        &db.database,
        &request.run_id,
        request.output_dir.clone(),
    )
    .await
}

pub fn print_help() {
    println!("{HELP}");
}

pub fn exit_with_error(code: u8, message: &str) -> ! {
    eprintln!("Error: {message}");
    std::process::exit(code as i32);
}

pub fn attach_parent_console() {
    #[cfg(windows)]
    {
        extern "system" {
            fn AttachConsole(process_id: u32) -> i32;
        }
        const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
        unsafe {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
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
                    summary.error.map(|value| format!("{value}; ")).unwrap_or_default(),
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
    let db = app.state::<crate::database::LocalDb>();
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
            let focus = aspect
                .focus_hit_rate
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            let mean_err = aspect
                .mean_focus_error_radius
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "—".to_string());
            let visibility = aspect
                .target_visibility_rate
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            let dual_visibility = aspect
                .dual_target_all_visible_rate
                .map(|value| format!("{:.1}%", value * 100.0))
                .unwrap_or_else(|| "—".to_string());
            println!(
                "- {} {} focusHit={focus} visible={visibility} dualVisible={dual_visibility} meanErr={mean_err} [{}]",
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

pub fn is_benchmark_cli_active() -> bool {
    BENCHMARK_CLI_ACTIVE.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn get_benchmark_cli_request(
    request: tauri::State<'_, Option<CliRequest>>,
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
    request: tauri::State<'_, Option<CliRequest>>,
    summary: BenchmarkCliSummary,
) {
    let (benchmark_request, json_output) = match request.inner() {
        Some(CliRequest::BenchmarkRun(value)) => (Some(value.clone()), value.json_output),
        _ => (None, false),
    };
    finish_benchmark_cli(&app, benchmark_request.as_ref(), summary, json_output);
}
