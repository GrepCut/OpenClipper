use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use super::super::diagnostics;
use super::super::internal::{FaceResult, FaceWorkerMsg, ObjectResult, ObjectWorkerMsg, WorkerResult};
use super::super::vision::NativeVisionError;
use super::setup::PipelineSetup;
use super::types::NativeVisionProgress;

pub(crate) struct DrainOutput {
    pub face_results: BTreeMap<usize, FaceResult>,
    pub object_results: BTreeMap<usize, ObjectResult>,
    pub drain_duration_ms: u64,
    pub face_preprocess_ms: u64,
    pub pose_preprocess_ms: u64,
}

pub(crate) fn drain_workers(
    setup: PipelineSetup,
    sample_count: usize,
    total_duration: f64,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<DrainOutput, NativeVisionError> {
    diagnostics::append(
        "drain",
        &format!(
            "start sample_count={sample_count} face_workers={} object_workers={} face_queue={} object_queue={}",
            setup.face_workers.len(),
            setup.object_workers.len(),
            setup.face_job_sender.len(),
            setup.object_job_sender.len(),
        ),
    );
    let _ = setup
        .face_msg_sender
        .send(FaceWorkerMsg::Total(sample_count));
    let _ = setup
        .object_msg_sender
        .send(ObjectWorkerMsg::Total(sample_count));
    drop(setup.face_msg_sender);
    drop(setup.object_msg_sender);
    drop(setup.face_job_sender);
    drop(setup.object_job_sender);
    let drain_started = Instant::now();
    if progress(NativeVisionProgress {
        phase: "draining",
        percent: 90,
        timestamp_sec: total_duration,
        eta_seconds: None,
        face_sample: None,
        subject_sample: None,
        queued_detections: sample_count * 2,
    })
    .is_err()
    {
        cancelled.store(true, Ordering::Relaxed);
    }
    diagnostics::append("drain", "joining face policy");
    let face_policy_join = setup.face_policy.join();
    diagnostics::append(
        "drain",
        &format!("face policy joined ok={}", face_policy_join.is_ok()),
    );
    let mut worker_panicked = face_policy_join.is_err();
    diagnostics::append("drain", "joining object policy");
    let object_policy_join = setup.object_policy.join();
    diagnostics::append(
        "drain",
        &format!("object policy joined ok={}", object_policy_join.is_ok()),
    );
    worker_panicked |= object_policy_join.is_err();
    for worker in setup.face_workers {
        diagnostics::append("drain", "joining face worker");
        let joined = worker.join();
        diagnostics::append(
            "drain",
            &format!("face worker joined ok={}", joined.is_ok()),
        );
        worker_panicked |= joined.is_err();
    }
    for worker in setup.object_workers {
        diagnostics::append("drain", "joining object worker");
        let joined = worker.join();
        diagnostics::append(
            "drain",
            &format!("object worker joined ok={}", joined.is_ok()),
        );
        worker_panicked |= joined.is_err();
    }
    let drain_duration_ms = drain_started.elapsed().as_millis() as u64;
    let face_preprocess_ms = setup.face_preprocess_time_us.load(Ordering::Relaxed) / 1_000;
    let pose_preprocess_ms = setup.pose_preprocess_time_us.load(Ordering::Relaxed) / 1_000;

    let mut face_results = BTreeMap::new();
    let mut object_results = BTreeMap::new();
    let mut first_error = None;
    for result in setup.result_receiver.try_iter() {
        match result {
            WorkerResult::Face(value) => {
                face_results.insert(value.index, value);
            }
            WorkerResult::Object(value) => {
                object_results.insert(value.index, value);
            }
            WorkerResult::Error(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    diagnostics::append(
        "drain",
        &format!(
            "collected face_results={} object_results={} first_error={}",
            face_results.len(),
            object_results.len(),
            first_error.is_some(),
        ),
    );
    if let Some(error) = first_error {
        return Err(error);
    }
    if worker_panicked {
        return Err(NativeVisionError::new(
            "evaluation_failed",
            "Native vision worker crashed; see open-clipper-face-action.log in Downloads",
            true,
        ));
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(NativeVisionError::new(
            "cancelled",
            "Native analysis was cancelled",
            false,
        ));
    }
    if face_results.len() != sample_count || object_results.len() != sample_count {
        return Err(NativeVisionError::new(
            "evaluation_failed",
            format!(
                "Incomplete native result set: face {}/{sample_count}, object {}/{sample_count}",
                face_results.len(),
                object_results.len()
            ),
            true,
        ));
    }
    Ok(DrainOutput {
        face_results,
        object_results,
        drain_duration_ms,
        face_preprocess_ms,
        pose_preprocess_ms,
    })
}
