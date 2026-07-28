use clap::{CommandFactory, Parser};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

static BENCHMARK_CLI_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Parser, Debug)]
#[command(
    name = "open-clipper",
    about = "Open Clipper benchmark CLI",
    disable_help_flag = true
)]
struct CliArgs {
    #[arg(long, short = 'h', help = "Show this help")]
    help: bool,
    #[arg(long, help = "Run clips in a test dataset headlessly")]
    benchmark_run: Option<String>,
    #[arg(long, help = "Compare output against the remembered baseline")]
    check: bool,
    #[arg(long, help = "Pin the completed run as the dataset baseline")]
    remember: bool,
    #[arg(
        long,
        value_name = "object-tiles,face-tiles",
        help = "Benchmark-only recovery ablations (requires --benchmark-run and --check)"
    )]
    vision_ablation: Option<String>,
    #[arg(
        long,
        num_args = 0..=1,
        help = "Export worst keyframe JPEGs for a completed run, or after --benchmark-run when no run id is given"
    )]
    extract_miss_frames: Option<Option<String>>,
    #[arg(long, help = "Custom flat export directory (extract mode only)")]
    output: Option<PathBuf>,
    #[arg(long, help = "Print machine-readable JSON summary to stdout")]
    json: bool,
}

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
    pub check: bool,
    pub remember: bool,
    pub vision_ablation: BenchmarkVisionAblation,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkVisionAblation {
    pub disable_object_tile_recovery: bool,
    pub disable_face_tile_recovery: bool,
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
    pub matches_baseline: Option<bool>,
    pub mse: Option<f64>,
    pub frame_count: Option<usize>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliDriftSummary {
    pub baseline_run_id: String,
    pub matches_baseline: bool,
    pub mse: Option<f64>,
    pub max_frame_mse: Option<f64>,
    pub changed_frame_count: usize,
    pub structural_mismatch_count: usize,
    pub compared_frames: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliAspectSummary {
    pub aspect_id: String,
    pub status: String,
    pub coverage_hit_rate: Option<f64>,
    pub mean_coverage_fraction: Option<f64>,
    pub dual_target_all_covered_rate: Option<f64>,
    pub layout_mode_rates: Option<HashMap<String, f64>>,
    pub median_coverage_fraction: Option<f64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCliSummary {
    pub dataset_id: String,
    pub dataset_name: String,
    pub run_id: String,
    pub status: String,
    pub mode: String,
    pub completed_clips: usize,
    pub failed_clips: usize,
    pub manifest_path: Option<String>,
    pub miss_frames_export_dir: Option<String>,
    pub miss_frames_count: Option<usize>,
    pub drift_summary: Option<BenchmarkCliDriftSummary>,
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
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.is_empty() {
        return None;
    }

    let args = match CliArgs::try_parse_from(std::env::args()) {
        Ok(args) => args,
        Err(error) => {
            if error.kind() == clap::error::ErrorKind::DisplayHelp {
                print!("{error}");
                std::process::exit(0);
            }
            exit_with_error(2, &error.to_string());
        }
    };

    if args.help {
        print_help();
        std::process::exit(0);
    }

    if args.vision_ablation.is_some() && (args.benchmark_run.is_none() || !args.check) {
        exit_with_error(
            2,
            "--vision-ablation requires --benchmark-run <dataset> together with --check.",
        );
    }
    let vision_ablation = args
        .vision_ablation
        .as_deref()
        .map(parse_vision_ablation)
        .transpose()
        .unwrap_or_else(|message| exit_with_error(2, &message))
        .unwrap_or_default();

    if let Some(Some(run_id)) = &args.extract_miss_frames {
        if args.benchmark_run.is_some() {
            exit_with_error(
                2,
                "Use either --benchmark-run or --extract-miss-frames <run-id>, not both.",
            );
        }
        BENCHMARK_CLI_ACTIVE.store(true, Ordering::SeqCst);
        return Some(CliRequest::ExtractMissFrames(ExtractMissFramesCliRequest {
            run_id: run_id.clone(),
            output_dir: args.output,
            json_output: args.json,
        }));
    }

    let Some(dataset_id) = args.benchmark_run else {
        return None;
    };

    BENCHMARK_CLI_ACTIVE.store(true, Ordering::SeqCst);
    Some(CliRequest::BenchmarkRun(BenchmarkCliRequest {
        dataset_id: normalize_dataset_arg(&dataset_id),
        json_output: args.json,
        extract_miss_frames: args.extract_miss_frames.is_some(),
        check: args.check,
        remember: args.remember,
        vision_ablation,
    }))
}

fn parse_vision_ablation(raw: &str) -> Result<BenchmarkVisionAblation, String> {
    let mut config = BenchmarkVisionAblation::default();
    if raw.trim().is_empty() {
        return Err("--vision-ablation must list at least one ablation.".into());
    }
    for token in raw.split(',').map(str::trim) {
        let target = match token {
            "object-tiles" => &mut config.disable_object_tile_recovery,
            "face-tiles" => &mut config.disable_face_tile_recovery,
            unknown => {
                return Err(format!(
                    "Unknown vision ablation '{unknown}'. Expected object-tiles or face-tiles."
                ))
            }
        };
        if *target {
            return Err(format!("Duplicate vision ablation '{token}'."));
        }
        *target = true;
    }
    Ok(config)
}

pub fn is_benchmark_cli_argv(argv: &[String]) -> bool {
    argv.iter()
        .any(|arg| arg == "--benchmark-run" || arg == "--extract-miss-frames")
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
        .unwrap_or_else(|message: String| exit_with_error(2, &message));
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

pub fn print_help() {
    let _ = CliArgs::command().print_help();
    crate::cli::runner::stdout_line("");
}

pub fn exit_with_error(code: u8, message: &str) -> ! {
    crate::cli::runner::stderr_line(&format!("Error: {message}"));
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

pub fn is_benchmark_cli_active() -> bool {
    BENCHMARK_CLI_ACTIVE.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_independent_vision_ablation_switches() {
        let parsed = parse_vision_ablation("object-tiles,face-tiles").unwrap();
        assert!(parsed.disable_object_tile_recovery);
        assert!(parsed.disable_face_tile_recovery);
    }

    #[test]
    fn rejects_unknown_and_duplicate_vision_ablations() {
        assert!(parse_vision_ablation("unknown").is_err());
        assert!(parse_vision_ablation("object-tiles,object-tiles").is_err());
        assert!(parse_vision_ablation("").is_err());
    }
}
