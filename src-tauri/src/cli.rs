use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

static BENCHMARK_CLI_ACTIVE: AtomicBool = AtomicBool::new(false);

const HELP: &str = "\
Open Clipper benchmark CLI

Usage:
  open-clipper --benchmark-run <dataset-id-or-path> [--json]

Options:
  --benchmark-run <id-or-path>  Run annotated clips in a test dataset headlessly
  --json                        Print machine-readable JSON summary to stdout
  --help, -h                    Show this help

Examples:
  open-clipper --benchmark-run cd986c2a-d998-4a96-afec-218d052d8c78
  open-clipper --benchmark-run \"%APPDATA%\\com.openclipper.app\\test-datasets\\cd986c2a-...\"
";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliRequest {
    pub dataset_id: String,
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
    pub error: Option<String>,
    pub clips: Vec<BenchmarkCliClipSummary>,
}

pub fn parse_args() -> Option<BenchmarkCliRequest> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return None;
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print_help();
        std::process::exit(0);
    }

    let mut dataset_id: Option<String> = None;
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
            "--json" => json_output = true,
            unknown => exit_with_error(2, &format!("Unknown argument: {unknown}")),
        }
        index += 1;
    }

    dataset_id.map(|dataset_id| {
        BENCHMARK_CLI_ACTIVE.store(true, Ordering::SeqCst);
        BenchmarkCliRequest {
            dataset_id,
            json_output,
        }
    })
}

pub fn is_benchmark_cli_argv(argv: &[String]) -> bool {
    argv.iter().any(|arg| arg == "--benchmark-run")
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
}

pub fn log_benchmark_progress(message: &str) {
    println!("{message}");
}

pub fn finish_benchmark_cli(app: &AppHandle, mut summary: BenchmarkCliSummary, json_output: bool) {
    resolve_manifest_path(app, &mut summary);
    let success = summary.status == "completed";
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
            println!(
                "- {} {} focusHit={focus} meanErr={mean_err} [{}]",
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
    request: tauri::State<'_, Option<BenchmarkCliRequest>>,
) -> Option<BenchmarkCliRequest> {
    request.inner().clone()
}

#[tauri::command]
pub fn log_benchmark_cli_progress(message: String) {
    log_benchmark_progress(&message);
}

#[tauri::command]
pub fn finish_benchmark_cli_command(
    app: AppHandle,
    request: tauri::State<'_, Option<BenchmarkCliRequest>>,
    summary: BenchmarkCliSummary,
) {
    let json_output = request
        .inner()
        .as_ref()
        .map(|value| value.json_output)
        .unwrap_or(false);
    finish_benchmark_cli(&app, summary, json_output);
}
