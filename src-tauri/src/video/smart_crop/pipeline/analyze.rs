use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::super::diagnostics;
use super::super::vision::NativeVisionError;
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
    diagnostics::start(&file_path, start_time, end_time, tracking_enabled);
    let result = (|| {
        if end_time <= start_time {
            return Err(NativeVisionError::new(
                "decode_failed",
                "Invalid analysis range",
                true,
            ));
        }
        diagnostics::append(
            "setup",
            &format!("preparing pipeline resources={}", resource_dir.display()),
        );
        let init = PipelineSetup::prepare(resource_dir, cancelled.clone(), &mut progress)?;
        diagnostics::append("setup", "workers and shadow models initialized");
        let mut setup = init.setup;
        let mut shadow_runner = init.shadow_runner;
        diagnostics::append("decode", "opening FFmpeg decode session");
        let mut session = DecodeSession::open(&file_path, start_time, end_time)?;
        let total_duration = session.total_duration();
        diagnostics::append(
            "decode",
            &format!("session opened total_duration={total_duration:.3}s"),
        );
        let decode_stats = session.run(
            &mut setup,
            &mut shadow_runner,
            cancelled.clone(),
            &mut progress,
        )?;
        diagnostics::append(
            "decode",
            &format!(
                "decode complete samples={} decoded_frames={} duration_ms={} face_queue_peak={} object_queue_peak={}",
                decode_stats.sample_count,
                decode_stats.decoded_frame_count,
                decode_stats.decode_duration_ms,
                decode_stats.peak_face_queue,
                decode_stats.peak_object_queue,
            ),
        );
        let drain = drain_workers(
            setup,
            decode_stats.sample_count,
            total_duration,
            cancelled,
            &mut progress,
        )?;
        diagnostics::append(
            "drain",
            &format!(
                "workers drained face_results={} object_results={} duration_ms={}",
                drain.face_results.len(),
                drain.object_results.len(),
                drain.drain_duration_ms,
            ),
        );
        let drain_duration_ms = drain.drain_duration_ms;
        let face_preprocess_ms = drain.face_preprocess_ms;
        let pose_preprocess_ms = drain.pose_preprocess_ms;
        diagnostics::append("merge", "starting tracking and result merge");
        let merged = merge_samples(
            decode_stats.sample_count,
            drain.face_results,
            drain.object_results,
            &mut shadow_runner,
            tracking_enabled,
            &mut progress,
        )?;
        diagnostics::append(
            "merge",
            &format!(
                "merge complete faces={} subjects={} face_device={:?} object_device={:?} pose_device={:?}",
                merged.face_samples.len(),
                merged.subject_samples.len(),
                merged.face_device,
                merged.object_device,
                merged.pose_device,
            ),
        );
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
    })();
    match &result {
        Ok(summary) => diagnostics::finish(&format!(
            "COMPLETE face_samples={} subject_samples={}",
            summary.face_sample_count, summary.subject_sample_count
        )),
        Err(error) => diagnostics::finish(&format!(
            "ERROR code={} fatal={} message={}",
            error.code, error.fatal, error.message
        )),
    }
    result
}
