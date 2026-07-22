mod app;
mod cli;
mod clipper;
mod commands;
mod infra;
mod storage;
pub mod transcription;
mod video;

pub use transcription::ParakeetService;

pub fn install_startup_diagnostics() {
    infra::startup_log::install_panic_hook();
}

pub fn run() {
    app::run();
}
