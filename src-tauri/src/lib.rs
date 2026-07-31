mod app;
mod clipper;
mod commands;
pub mod infra;
pub mod mcp;
pub mod storage;
pub mod transcription;
mod video;

pub fn run() {
    app::run();
}
