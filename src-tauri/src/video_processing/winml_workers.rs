//! WinML model worker threads (face and object detection).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Instant;

use super::vision_logic::{AutoFlipFaceDetection, decode_blaze, decode_movenet, detect_motion_saliency, weighted_face_nms, RecoveryPolicy, BLAZE_INPUT_SIZE, MOVENET_INPUT_SIZE};
use super::winml_internal::{AnalysisFrame, BaseFaceOutcome, FaceJob, FaceJobKind, FaceResult, FaceWorkerMsg, ObjectResult, PendingRecovery, WorkerResult, MAX_BATCH, POSE_PERSON_CONFIDENCE, POSE_PERSON_SAMPLE_STRIDE, POSE_RECOVERY_SAMPLE_STRIDE};
use super::winml_preprocess::{batch_stride, drain_batch, evaluate_yolox_batch, map_face_from_tile, prepare_blaze_into, prepare_movenet_into, recovery_tiles};
use super::winml_vision::{NativeVisionDevice, NativeVisionError, VisionModel, WinMlModel};

fn face_result_from(outcome: BaseFaceOutcome, recovery_passes: usize, extra_ms: u64) -> FaceResult {
    FaceResult {
        index: outcome.frame.index,
        time: outcome.frame.time,
        faces: outcome.faces,
        display_width: outcome.frame.display_width,
        display_height: outcome.frame.display_height,
        face_bucket: outcome.frame.face_bucket,
        scene_cut: outcome.frame.scene_cut,
        device: outcome.device,
        duration_ms: outcome.duration_ms + extra_ms,
        recovery_passes,
    }
}

/// Stateless BlazeFace evaluator. Frames arrive out of order across the pool;
/// the sequential recovery policy lives in `spawn_face_policy`.
pub(crate) fn spawn_face_worker(
    jobs: crossbeam_channel::Receiver<FaceJob>,
    results: mpsc::Sender<FaceWorkerMsg>,
    cancelled: Arc<AtomicBool>,
    model_path: std::path::PathBuf,
    fp16_model_path: std::path::PathBuf,
    preprocess_time_us: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut model: Option<WinMlModel> = None;
        let frame_elems = BLAZE_INPUT_SIZE * BLAZE_INPUT_SIZE * 3;
        let mut input = vec![-1.0f32; MAX_BATCH * frame_elems];
        let mut letterboxes = Vec::with_capacity(MAX_BATCH);
        'jobs: while let Ok(first) = jobs.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let batch = drain_batch(&jobs, first);
            let count = batch.len();
            // Sessions are compiled for batch sizes 1 and MAX_BATCH only;
            // multi-frame batches are padded up to the bound. Padding
            // elements keep the letterbox fill value (-1.0) and their
            // outputs are ignored below.
            let bound = if count == 1 { 1 } else { MAX_BATCH };
            let preprocess_started = Instant::now();
            let input = &mut input[..bound * frame_elems];
            input.fill(-1.0);
            letterboxes.clear();
            for (index, job) in batch.iter().enumerate() {
                let letterbox = prepare_blaze_into(
                    &job.frame,
                    &mut input[index * frame_elems..(index + 1) * frame_elems],
                );
                letterboxes.push(letterbox);
            }
            preprocess_time_us.fetch_add(
                preprocess_started.elapsed().as_micros() as u64,
                Ordering::Relaxed,
            );
            let shape = [bound as i64, 192, 192, 3];
            let started = Instant::now();
            let evaluated = if let Some(current) = model.as_mut() {
                current
                    .evaluate(&shape, input)
                    .map(|output| (output, current.device()))
            } else {
                WinMlModel::create(
                    VisionModel::Face,
                    &model_path,
                    Some(&fp16_model_path),
                    "input",
                    &["reshaped_regressor_face_4", "reshaped_classifier_face_4"],
                    &shape,
                    input,
                )
                .map(|(created, output)| {
                    let device = created.device();
                    model = Some(created);
                    (output, device)
                })
            };
            match evaluated.and_then(|(output, device)| {
                if output.len() != 2 {
                    return Err(NativeVisionError::new(
                        "tensor_contract_mismatch",
                        "BlazeFace output count changed",
                        true,
                    ));
                }
                let regressor_stride = batch_stride(output[0].len(), bound, "BlazeFace")?;
                let logits_stride = batch_stride(output[1].len(), bound, "BlazeFace")?;
                let mut outcomes = Vec::with_capacity(count);
                for index in 0..count {
                    let faces = decode_blaze(
                        &output[0][index * regressor_stride..(index + 1) * regressor_stride],
                        &output[1][index * logits_stride..(index + 1) * logits_stride],
                        letterboxes[index],
                        0.55,
                    )
                    .map_err(|message| {
                        NativeVisionError::new("tensor_contract_mismatch", message, true)
                    })?;
                    outcomes.push(faces);
                }
                Ok((outcomes, device))
            }) {
                Ok((outcomes, device)) => {
                    let duration_ms = started.elapsed().as_millis() as u64 / count as u64;
                    for (job, faces) in batch.into_iter().zip(outcomes) {
                        let message = match job.kind {
                            FaceJobKind::Base => FaceWorkerMsg::Base(BaseFaceOutcome {
                                frame: job.frame,
                                faces,
                                device,
                                duration_ms,
                            }),
                            FaceJobKind::Tile {
                                base_index,
                                offset_x,
                                offset_y,
                                span_x,
                                span_y,
                            } => FaceWorkerMsg::Tile {
                                base_index,
                                faces: faces
                                    .into_iter()
                                    .map(|face| {
                                        map_face_from_tile(face, offset_x, offset_y, span_x, span_y)
                                    })
                                    .collect(),
                                duration_ms,
                            },
                        };
                        if results.send(message).is_err() {
                            break 'jobs;
                        }
                    }
                }
                Err(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(FaceWorkerMsg::Error(error));
                    break;
                }
            }
        }
    })
}

/// Reorders pooled base-pass results back into frame order and applies the
/// sequential recovery policy exactly like the previous single-worker loop:
/// scene resets, miss counters, and tile recovery all observe frames in
/// order, while the tile evaluations themselves run on the worker pool.
pub(crate) fn spawn_face_policy(
    incoming: mpsc::Receiver<FaceWorkerMsg>,
    jobs: crossbeam_channel::Sender<FaceJob>,
    results: mpsc::Sender<WorkerResult>,
    cancelled: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut policy = RecoveryPolicy::default();
        policy.new_scene();
        let mut had_track = false;
        let mut reorder: BTreeMap<usize, BaseFaceOutcome> = BTreeMap::new();
        let mut next_index = 0usize;
        let mut finalized = 0usize;
        let mut total: Option<usize> = None;
        let mut recovery: Option<PendingRecovery> = None;

        'policy: while total != Some(finalized) {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let Ok(message) = incoming.recv() else {
                break;
            };
            match message {
                FaceWorkerMsg::Total(count) => total = Some(count),
                FaceWorkerMsg::Error(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(WorkerResult::Error(error));
                    break;
                }
                FaceWorkerMsg::Base(outcome) => {
                    reorder.insert(outcome.frame.index, outcome);
                }
                FaceWorkerMsg::Tile {
                    base_index,
                    faces,
                    duration_ms,
                } => {
                    let Some(pending) = recovery.as_mut() else {
                        continue;
                    };
                    debug_assert_eq!(pending.base.frame.index, base_index);
                    pending.collected.extend(faces);
                    pending.extra_duration_ms += duration_ms;
                    pending.remaining -= 1;
                    if pending.remaining == 0 {
                        let mut done = recovery.take().expect("checked pending recovery");
                        done.base.faces.append(&mut done.collected);
                        done.base.faces =
                            weighted_face_nms(std::mem::take(&mut done.base.faces), 0.4);
                        had_track = !done.base.faces.is_empty();
                        let recovery_passes = 4;
                        if results
                            .send(WorkerResult::Face(face_result_from(
                                done.base,
                                recovery_passes,
                                done.extra_duration_ms,
                            )))
                            .is_err()
                        {
                            break 'policy;
                        }
                        finalized += 1;
                        next_index += 1;
                    }
                }
            }
            // Advance through in-order base results until one needs recovery
            // (its tiles must finish before the next frame may be observed).
            while recovery.is_none() {
                let Some(outcome) = reorder.remove(&next_index) else {
                    break;
                };
                if outcome.frame.scene_cut {
                    policy.new_scene();
                    had_track = false;
                }
                let _should_recover = policy.observe(
                    outcome.frame.time,
                    outcome.frame.face_bucket,
                    !outcome.faces.is_empty(),
                    false,
                    had_track,
                );
                let should_recover = false;
                if should_recover {
                    let tiles = recovery_tiles(&outcome.frame);
                    let tile_count = tiles.len();
                    for (tile, offset_x, offset_y, span_x, span_y) in tiles {
                        let job = FaceJob {
                            frame: Arc::new(tile),
                            kind: FaceJobKind::Tile {
                                base_index: outcome.frame.index,
                                offset_x,
                                offset_y,
                                span_x,
                                span_y,
                            },
                        };
                        if jobs.send(job).is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                            break 'policy;
                        }
                    }
                    recovery = Some(PendingRecovery {
                        base: outcome,
                        collected: Vec::new(),
                        remaining: tile_count,
                        extra_duration_ms: 0,
                    });
                } else {
                    had_track = !outcome.faces.is_empty();
                    if results
                        .send(WorkerResult::Face(face_result_from(outcome, 0, 0)))
                        .is_err()
                    {
                        break 'policy;
                    }
                    finalized += 1;
                    next_index += 1;
                }
            }
        }
    })
}

pub(crate) fn spawn_object_worker(
    jobs: crossbeam_channel::Receiver<Arc<AnalysisFrame>>,
    results: mpsc::Sender<WorkerResult>,
    cancelled: Arc<AtomicBool>,
    yolox_model_path: std::path::PathBuf,
    pose_model_path: std::path::PathBuf,
    yolox_labels: Arc<Vec<String>>,
    pose_preprocess_time_us: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut yolox_model: Option<WinMlModel> = None;
        let mut pose_model: Option<WinMlModel> = None;
        let mut pose_sample_index = 0usize;
        let mut previous_motion_frame: Option<Arc<AnalysisFrame>> = None;
        while let Ok(first) = jobs.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let batch = drain_batch(&jobs, first);
            let count = batch.len();
            let started = Instant::now();
            // YOLOX is the sole object detector: a failed evaluation aborts
            // this clip's analysis instead of silently falling back to a
            // second detector.
            let decoded =
                evaluate_yolox_batch(&mut yolox_model, &batch, &yolox_model_path, &yolox_labels);
            match decoded {
                Ok((outcomes, device)) => {
                    let duration_ms = started.elapsed().as_millis() as u64 / count as u64;
                    for (frame, detections) in batch.into_iter().zip(outcomes) {
                        let motion_signal = if frame.scene_cut {
                            None
                        } else {
                            previous_motion_frame.as_ref().and_then(|previous| {
                                (previous.width == frame.width && previous.height == frame.height).then(|| {
                                    detect_motion_saliency(
                                        &previous.rgb,
                                        &frame.rgb,
                                        frame.width as usize,
                                        frame.height as usize,
                                    )
                                }).flatten()
                            })
                        };
                        previous_motion_frame = Some(frame.clone());
                        let has_person = detections.iter().any(|detection| {
                            detection.label.eq_ignore_ascii_case("person")
                                && detection.score >= POSE_PERSON_CONFIDENCE
                        });
                        let should_run_pose = if frame.scene_cut {
                            true
                        } else if has_person {
                            pose_sample_index % POSE_PERSON_SAMPLE_STRIDE == 0
                        } else {
                            pose_sample_index % POSE_RECOVERY_SAMPLE_STRIDE == 0
                        };
                        pose_sample_index = pose_sample_index.wrapping_add(1);
                        if !should_run_pose {
                            let pose_device = pose_model
                                .as_ref()
                                .map(WinMlModel::device)
                                .unwrap_or(NativeVisionDevice::Cpu);
                            let _ = results.send(WorkerResult::Object(ObjectResult {
                                index: frame.index,
                                time: frame.time,
                                detections,
                                poses: Vec::new(),
                                motion_signal,
                                device,
                                pose_device,
                                duration_ms,
                                pose_duration_ms: 0,
                            }));
                            continue;
                        }
                        let pose_preprocess_started = Instant::now();
                        let mut pose_input =
                            vec![0.0f32; MOVENET_INPUT_SIZE * MOVENET_INPUT_SIZE * 3];
                        let letterbox = prepare_movenet_into(&frame, &mut pose_input);
                        pose_preprocess_time_us.fetch_add(
                            pose_preprocess_started.elapsed().as_micros() as u64,
                            Ordering::Relaxed,
                        );
                        let pose_shape =
                            [1, MOVENET_INPUT_SIZE as i64, MOVENET_INPUT_SIZE as i64, 3];
                        let pose_started = Instant::now();
                        let evaluated_pose = if let Some(current) = pose_model.as_mut() {
                            current
                                .evaluate(&pose_shape, &pose_input)
                                .map(|output| (output, current.device()))
                        } else {
                            WinMlModel::create(
                                VisionModel::Pose,
                                &pose_model_path,
                                None,
                                "input",
                                &["output_0"],
                                &pose_shape,
                                &pose_input,
                            )
                            .map(|(created, output)| {
                                let pose_device = created.device();
                                pose_model = Some(created);
                                (output, pose_device)
                            })
                        };
                        let (poses, pose_device) =
                            match evaluated_pose.and_then(|(output, pose_device)| {
                                if output.len() != 1 {
                                    return Err(NativeVisionError::new(
                                        "tensor_contract_mismatch",
                                        "MoveNet output count changed",
                                        true,
                                    ));
                                }
                                decode_movenet(&output[0], letterbox)
                                    .map(|poses| (poses, pose_device))
                                    .map_err(|message| {
                                        NativeVisionError::new(
                                            "tensor_contract_mismatch",
                                            message,
                                            true,
                                        )
                                    })
                            }) {
                                Ok(value) => value,
                                Err(error) => {
                                    cancelled.store(true, Ordering::Relaxed);
                                    let _ = results.send(WorkerResult::Error(error));
                                    return;
                                }
                            };
                        let _ = results.send(WorkerResult::Object(ObjectResult {
                            index: frame.index,
                            time: frame.time,
                            detections,
                            poses,
                            motion_signal,
                            device,
                            pose_device,
                            duration_ms,
                            pose_duration_ms: pose_started.elapsed().as_millis() as u64,
                        }));
                    }
                }
                Err(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(WorkerResult::Error(error));
                    break;
                }
            }
        }
    })
}

