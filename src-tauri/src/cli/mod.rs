mod args;
mod runner;

pub use args::{
    attach_parent_console, exit_with_error, is_benchmark_cli_active, is_benchmark_cli_argv,
    parse_args, BenchmarkCliRequest, BenchmarkCliSummary, CliRequest,
};
pub use runner::{
    ensure_dataset_exists, finish_benchmark_cli, finish_extract_miss_frames_cli,
    log_benchmark_progress, print_cli_start, print_extract_start, run_extract_miss_frames_cli,
};
