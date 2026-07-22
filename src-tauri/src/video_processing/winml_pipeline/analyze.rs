use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::super::winml_vision::NativeVisionError;
use super::decode_session::DecodeSession;
use super::drain::drain_workers;
use super::merge::merge_samples;
use super::setup::PipelineSetup;
use super::summary::build_summary;
use super::types::{NativeVisionProgress, NativeVisionSummary};

pub fn analyze(
    file_path: String,
    start_time: f64,
    end_time: f64,
    resource_dir: &Path,
    cancelled: Arc<AtomicBool>,
    tracking_enabled: bool,
    mut progress: impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<NativeVisionSummary, NativeVisionError> {
    if end_time <= start_time {
        return Err(NativeVisionError::new(
            "decode_failed",
            "Invalid analysis range",
            true,
        ));
    }
    let init = PipelineSetup::prepare(resource_dir, cancelled.clone(), &mut progress)?;
    let mut setup = init.setup;
    let mut shadow_runner = init.shadow_runner;
    let mut session = DecodeSession::open(&file_path, start_time, end_time)?;
    let total_duration = session.total_duration();
    let decode_stats =
        session.run(&mut setup, &mut shadow_runner, cancelled.clone(), &mut progress)?;
    let drain = drain_workers(
        setup,
        decode_stats.sample_count,
        total_duration,
        cancelled,
        &mut progress,
    )?;
    let drain_duration_ms = drain.drain_duration_ms;
    let face_preprocess_ms = drain.face_preprocess_ms;
    let pose_preprocess_ms = drain.pose_preprocess_ms;
    let merged = merge_samples(
        decode_stats.sample_count,
        drain.face_results,
        drain.object_results,
        &mut shadow_runner,
        tracking_enabled,
        &mut progress,
    )?;
    let shadow_diagnostics = shadow_runner.finish();
    build_summary(
        &session,
        decode_stats,
        drain_duration_ms,
        face_preprocess_ms,
        pose_preprocess_ms,
        merged,
        tracking_enabled,
        shadow_diagnostics,
        &mut progress,
    )
}
