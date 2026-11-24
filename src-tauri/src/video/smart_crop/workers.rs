//! WinML model worker threads (face and object detection).

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Instant;

use super::diagnostics;
use super::internal::{
    AnalysisFrame, BaseFaceOutcome, BaseObjectOutcome, FaceJob, FaceJobKind, FaceResult,
    FaceWorkerMsg, FinalizedObjectBase, ObjectJob, ObjectJobKind, ObjectResult, ObjectWorkerMsg,
    PendingObjectRecovery, PendingRecovery, VisionAblationConfig, WorkerMetrics, WorkerResult,
    MAX_BATCH, POSE_PERSON_CONFIDENCE, POSE_PERSON_SAMPLE_STRIDE, POSE_RECOVERY_SAMPLE_STRIDE,
};
use super::preprocess::{
    evaluate_yolox_batch, map_detection_from_tile, map_face_from_tile, prepare_face_canvas_u8,
    prepare_face_input_into, prepare_movenet_into, quality_face_tiles, quality_object_tiles,
    ModelFrame, RgbImage,
};
use super::vision::{NativeVisionDevice, NativeVisionError, NativeVisionModel, VisionModel};
use super::vision_logic::{
    box_iou, decode_canvas_view, decode_movenet, decode_single_view, detect_motion_saliency,
    fuse_views, merge_subject_detections, weighted_face_nms, AutoFlipFaceDetection, FaceViewShape,
    Letterbox, NormalizedBox, RecoveryPolicy, SubjectDetection, FACE_CANVAS, FACE_CANVAS_INPUT,
    FACE_CANVAS_OUTPUTS, FACE_CANVAS_VIEWS, FACE_SINGLE_VIEWS, FACE_VIEW_INPUT, FACE_VIEW_OUTPUTS,
    MOVENET_INPUT_SIZE, YOLOX_INPUT_SIZE,
};

const RECOVERY_PERSON_SCORE: f32 = 0.7;
const RECOVERY_CONTINUITY_IOU: f32 = 0.1;

fn should_schedule_face_recovery(recover: bool, config: VisionAblationConfig) -> bool {
    recover && !config.disable_face_tile_recovery
}

fn should_schedule_object_recovery(recover: bool, config: VisionAblationConfig) -> bool {
    recover && !config.disable_object_tile_recovery
}

fn strongest_person_box(detections: &[SubjectDetection]) -> Option<NormalizedBox> {
    detections
        .iter()
        .filter(|detection| {
            detection.label.eq_ignore_ascii_case("person")
                && detection.score >= RECOVERY_PERSON_SCORE
        })
        .max_by(|left, right| {
            left.score
                .partial_cmp(&right.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|detection| detection.box_)
}

fn object_result_from(base: FinalizedObjectBase) -> ObjectResult {
    ObjectResult {
        index: base.frame.index,
        time: base.frame.time,
        detections: base.detections,
        poses: base.poses,
        motion_signal: base.motion_signal,
        device: base.device,
        pose_device: base.pose_device,
        duration_ms: base.duration_ms,
        pose_duration_ms: base.pose_duration_ms,
        recovery_passes: base.recovery_passes,
    }
}

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

/// Returns the retained face session for `key`, creating it on first use.
/// Face graphs run on the bundled ORT DirectML build: YuNet's thin depthwise
/// layers are about twice as fast there as on the OS WinML.
fn face_session<'a, K: std::hash::Hash + Eq>(
    models: &'a mut HashMap<K, NativeVisionModel>,
    key: K,
    path: &Path,
    input_name: &str,
    output_names: &[&str],
) -> Result<&'a mut NativeVisionModel, NativeVisionError> {
    Ok(match models.entry(key) {
        Entry::Occupied(entry) => entry.into_mut(),
        Entry::Vacant(entry) => entry.insert(NativeVisionModel::create_ort(
            path,
            input_name,
            output_names,
        )?),
    })
}

fn face_contract_error(message: String) -> NativeVisionError {
    NativeVisionError::new("tensor_contract_mismatch", message, true)
}

/// Per-view faces of one frame from the fused canvas graph: one uint8 upload
/// and one evaluation compute all three scales.
fn evaluate_face_canvas(
    models: &mut HashMap<FaceViewShape, NativeVisionModel>,
    model_root: &Path,
    image: RgbImage,
    input: &mut [u8],
    scratch: &mut [u8],
    output: &mut Vec<Vec<f32>>,
    preprocess_us: &mut u64,
) -> Result<(Vec<Vec<AutoFlipFaceDetection>>, NativeVisionDevice), NativeVisionError> {
    let started = Instant::now();
    let shape = FACE_CANVAS.shape_for(image.width, image.height);
    let (width, height) = FACE_CANVAS.dimensions(shape);
    let input = &mut input[..width * height * 3];
    let letterbox = prepare_face_canvas_u8(image, (width, height), input, scratch);
    *preprocess_us += started.elapsed().as_micros() as u64;
    let model = face_session(
        models,
        shape,
        &model_root.join(FACE_CANVAS.file(shape)),
        FACE_CANVAS_INPUT,
        &FACE_CANVAS_OUTPUTS,
    )?;
    model.evaluate_u8_into(&[1, height as i64, width as i64, 3], input, output)?;
    let views = FACE_CANVAS_VIEWS
        .iter()
        .enumerate()
        .map(|(index, view)| {
            let branch = Letterbox {
                scale: letterbox.scale * view.size as f32 / FACE_CANVAS.size as f32,
                ..letterbox
            };
            decode_canvas_view(index, shape, output, branch).map_err(face_contract_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((views, model.device()))
}

/// Per-view faces of a recovery tile, or of a source too small for the
/// validated 1536 upscale, from the square single-view graphs. Both views
/// always run, even past the validated upscale: fusion discounts a face seen
/// by a single view below the score threshold, so one view alone could
/// never report a face.
fn evaluate_face_single_views(
    models: &mut HashMap<usize, NativeVisionModel>,
    model_root: &Path,
    image: RgbImage,
    inputs: &mut [Vec<f32>],
    scratch: &mut [u8],
    output: &mut Vec<Vec<f32>>,
    preprocess_us: &mut u64,
) -> Result<(Vec<Vec<AutoFlipFaceDetection>>, NativeVisionDevice), NativeVisionError> {
    let mut views = Vec::with_capacity(FACE_SINGLE_VIEWS.len());
    let mut device = NativeVisionDevice::Cpu;
    for (index, (view, input)) in FACE_SINGLE_VIEWS.iter().zip(inputs.iter_mut()).enumerate() {
        let started = Instant::now();
        let (width, height) = view.dimensions(FaceViewShape::Square);
        let letterbox = prepare_face_input_into(image, (width, height), view.flip, input, scratch);
        *preprocess_us += started.elapsed().as_micros() as u64;
        let model = face_session(
            models,
            index,
            &model_root.join(view.file(FaceViewShape::Square)),
            FACE_VIEW_INPUT,
            FACE_VIEW_OUTPUTS,
        )?;
        model.evaluate_into(&[1, 3, height as i64, width as i64], input, output)?;
        device = model.device();
        views.push(decode_single_view(*view, output, letterbox).map_err(face_contract_error)?);
    }
    Ok((views, device))
}

/// Stateless face evaluator. Frames arrive out of order across the pool;
/// the sequential recovery policy lives in `spawn_face_policy`. Base frames
/// run through the fused canvas graph, recovery tiles through the square
/// single-view graphs, and the per-view faces are fused by agreement.
pub(crate) fn spawn_face_worker(
    jobs: crossbeam_channel::Receiver<FaceJob>,
    results: mpsc::Sender<FaceWorkerMsg>,
    cancelled: Arc<AtomicBool>,
    model_root: PathBuf,
    preprocess_time_us: Arc<AtomicU64>,
    worker_metrics: Arc<WorkerMetrics>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        diagnostics::append(
            "face-worker",
            &format!("started root={}", model_root.display()),
        );
        let canvas_elements = FACE_CANVAS.size * FACE_CANVAS.size * 3;
        let mut canvas_models = HashMap::new();
        let mut view_models = HashMap::new();
        let mut canvas_input = vec![0u8; canvas_elements];
        let mut resize_scratch = vec![0u8; canvas_elements];
        let mut region_rgb = Vec::new();
        let mut view_inputs: Vec<Vec<f32>> = FACE_SINGLE_VIEWS
            .iter()
            .map(|view| vec![0.0; view.size * view.size * 3])
            .collect();
        let mut output = Vec::with_capacity(FACE_CANVAS_OUTPUTS.len());
        while let Ok(job) = jobs.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            worker_metrics
                .face_inference_calls
                .fetch_add(1, Ordering::Relaxed);
            worker_metrics
                .face_inference_frames
                .fetch_add(1, Ordering::Relaxed);
            let started = Instant::now();
            // Recovery tiles always resize, so their region is copied once
            // here and shared by both single views.
            let image = RgbImage::of_region(&job.frame, job.region, &mut region_rgb);
            let mut preprocess_us = started.elapsed().as_micros() as u64;
            let evaluated = if FACE_CANVAS.within_validated_upscale(image.width, image.height) {
                evaluate_face_canvas(
                    &mut canvas_models,
                    &model_root,
                    image,
                    &mut canvas_input,
                    &mut resize_scratch,
                    &mut output,
                    &mut preprocess_us,
                )
            } else {
                evaluate_face_single_views(
                    &mut view_models,
                    &model_root,
                    image,
                    &mut view_inputs,
                    &mut resize_scratch,
                    &mut output,
                    &mut preprocess_us,
                )
            };
            preprocess_time_us.fetch_add(preprocess_us, Ordering::Relaxed);
            let duration_ms =
                (started.elapsed().as_micros() as u64).saturating_sub(preprocess_us) / 1000;
            match evaluated {
                Ok((views, device)) => {
                    let faces = fuse_views(views);
                    let message = match job.kind {
                        FaceJobKind::Base => {
                            worker_metrics
                                .face_base_inference_ms
                                .fetch_add(duration_ms, Ordering::Relaxed);
                            FaceWorkerMsg::Base(BaseFaceOutcome {
                                frame: job.frame,
                                faces,
                                device,
                                duration_ms,
                            })
                        }
                        FaceJobKind::Tile {
                            base_index,
                            offset_x,
                            offset_y,
                            span_x,
                            span_y,
                        } => {
                            worker_metrics
                                .face_recovery_inference_ms
                                .fetch_add(duration_ms, Ordering::Relaxed);
                            FaceWorkerMsg::Tile {
                                base_index,
                                faces: faces
                                    .into_iter()
                                    .map(|face| {
                                        map_face_from_tile(face, offset_x, offset_y, span_x, span_y)
                                    })
                                    .collect(),
                                duration_ms,
                            }
                        }
                    };
                    if results.send(message).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    diagnostics::append(
                        "face-worker",
                        &format!(
                            "ERROR code={} fatal={} message={}",
                            error.code, error.fatal, error.message
                        ),
                    );
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(FaceWorkerMsg::Error(error));
                    break;
                }
            }
        }
        diagnostics::append("face-worker", "stopped");
    })
}

/// Reorders pooled base-pass results and runs expensive high-detail face tiles
/// only when the base detector loses a target.  This keeps profile/occlusion
/// recovery while avoiding a full tile grid for ordinary talking-head video.
pub(crate) fn spawn_face_policy(
    incoming: mpsc::Receiver<FaceWorkerMsg>,
    jobs: crossbeam_channel::Sender<FaceJob>,
    results: mpsc::Sender<WorkerResult>,
    cancelled: Arc<AtomicBool>,
    vision_ablation: VisionAblationConfig,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reorder: BTreeMap<usize, BaseFaceOutcome> = BTreeMap::new();
        let mut next_index = 0usize;
        let mut finalized = 0usize;
        let mut total: Option<usize> = None;
        let mut recovery: Option<PendingRecovery> = None;
        let mut recovery_policy = RecoveryPolicy::default();
        recovery_policy.new_scene();
        let mut had_face_track = false;

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
                        had_face_track |= !done.base.faces.is_empty();
                        let recovery_passes = done.pass_count;
                        diagnostics::append(
                            "face-policy",
                            &format!(
                                "tile merge complete frame={} tile_passes={} faces={}",
                                done.base.frame.index,
                                recovery_passes,
                                done.base.faces.len(),
                            ),
                        );
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
            // Advance through in-order base results until one needs tiling;
            // those tiles finish before the next frame is published.
            while recovery.is_none() {
                let Some(outcome) = reorder.remove(&next_index) else {
                    break;
                };
                if outcome.frame.scene_cut {
                    recovery_policy.new_scene();
                    had_face_track = false;
                }
                let has_face = !outcome.faces.is_empty();
                let recover_face = recovery_policy.observe(
                    outcome.frame.time,
                    outcome.frame.face_bucket,
                    has_face,
                    false,
                    had_face_track,
                );
                had_face_track |= has_face;
                if should_schedule_face_recovery(recover_face, vision_ablation) {
                    let tiles = quality_face_tiles(&outcome.frame);
                    let tile_count = tiles.len();
                    diagnostics::append(
                        "face-policy",
                        &format!(
                            "face recovery tiling frame={} source={}x{} tiles={tile_count}",
                            outcome.frame.index, outcome.frame.width, outcome.frame.height,
                        ),
                    );
                    for tile in tiles {
                        let job = FaceJob {
                            frame: outcome.frame.clone(),
                            region: Some(tile.region),
                            kind: FaceJobKind::Tile {
                                base_index: outcome.frame.index,
                                offset_x: tile.offset_x,
                                offset_y: tile.offset_y,
                                span_x: tile.span_x,
                                span_y: tile.span_y,
                            },
                        };
                        if jobs.send(job).is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                            break 'policy;
                        }
                    }
                    if tile_count > 0 {
                        recovery = Some(PendingRecovery {
                            base: outcome,
                            collected: Vec::new(),
                            remaining: tile_count,
                            pass_count: tile_count,
                            extra_duration_ms: 0,
                        });
                        continue;
                    }
                }
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
    })
}

#[allow(clippy::too_many_arguments)]
fn evaluate_object_detection_batch(
    batch: Vec<ObjectJob>,
    base_jobs: &crossbeam_channel::Receiver<ObjectJob>,
    yolox_evaluation_count: &mut usize,
    yolox_model: &mut Option<NativeVisionModel>,
    yolox_input: &mut Vec<f32>,
    yolox_letterboxes: &mut Vec<Letterbox>,
    yolox_output: &mut Vec<Vec<f32>>,
    yolox_model_path: &std::path::Path,
    yolox_fp16_path: &std::path::Path,
    yolox_labels: &[String],
    results: &mpsc::Sender<ObjectWorkerMsg>,
    cancelled: &AtomicBool,
    worker_metrics: &WorkerMetrics,
) -> bool {
    let frames: Vec<ModelFrame<'_>> = batch
        .iter()
        .map(|job| match &job.kind {
            ObjectJobKind::Base { frame, .. } => ModelFrame {
                frame,
                region: None,
            },
            ObjectJobKind::Tile { frame, region, .. } => ModelFrame {
                frame,
                region: *region,
            },
            _ => unreachable!(),
        })
        .collect();
    for frame in &frames {
        if let Some(region) = frame.region {
            worker_metrics
                .zero_copy_tile_count
                .fetch_add(1, Ordering::Relaxed);
            worker_metrics.zero_copy_tile_bytes_avoided.fetch_add(
                region.width as u64 * region.height as u64 * 3,
                Ordering::Relaxed,
            );
        }
    }
    let started = Instant::now();
    *yolox_evaluation_count += 1;
    if *yolox_evaluation_count == 1 || *yolox_evaluation_count % 128 == 0 {
        diagnostics::append(
            "object-worker",
            &format!(
                "yolox heartbeat evaluation={} real_count={} bound={} first_index={} base_queue_remaining={}",
                *yolox_evaluation_count,
                batch.len(),
                if batch.len() == 1 { 1 } else { MAX_BATCH },
                frames[0].frame.index,
                base_jobs.len(),
            ),
        );
    }
    match evaluate_yolox_batch(
        yolox_model,
        &frames,
        yolox_input,
        yolox_letterboxes,
        yolox_output,
        yolox_model_path,
        yolox_fp16_path,
        yolox_labels,
    ) {
        Ok((outcomes, device, telemetry)) => {
            worker_metrics
                .object_preprocess_time_us
                .fetch_add(telemetry.preprocess_us, Ordering::Relaxed);
            worker_metrics
                .object_decode_time_us
                .fetch_add(telemetry.decode_us, Ordering::Relaxed);
            worker_metrics
                .yolox_fast_decode_skipped_rows
                .fetch_add(telemetry.fast_decode_skipped_rows, Ordering::Relaxed);
            let duration_ms = started.elapsed().as_millis() as u64 / batch.len().max(1) as u64;
            let base_count = batch
                .iter()
                .filter(|job| matches!(&job.kind, ObjectJobKind::Base { .. }))
                .count() as u64;
            worker_metrics
                .object_base_inference_ms
                .fetch_add(duration_ms * base_count, Ordering::Relaxed);
            worker_metrics.object_recovery_inference_ms.fetch_add(
                duration_ms * (batch.len() as u64 - base_count),
                Ordering::Relaxed,
            );
            for (job, detections) in batch.into_iter().zip(outcomes) {
                let message = match job.kind {
                    ObjectJobKind::Base { frame, permit } => {
                        ObjectWorkerMsg::Base(BaseObjectOutcome {
                            frame,
                            permit,
                            detections,
                            device,
                            duration_ms,
                        })
                    }
                    ObjectJobKind::Tile {
                        base_index,
                        offset_x,
                        offset_y,
                        span_x,
                        span_y,
                        ..
                    } => ObjectWorkerMsg::Tile {
                        base_index,
                        detections: detections
                            .into_iter()
                            .map(|detection| {
                                map_detection_from_tile(
                                    detection, offset_x, offset_y, span_x, span_y,
                                )
                            })
                            .collect(),
                        duration_ms,
                    },
                    _ => unreachable!(),
                };
                if results.send(message).is_err() {
                    return false;
                }
            }
            true
        }
        Err(error) => {
            diagnostics::append(
                "object-worker",
                &format!(
                    "yolox failed evaluation={} real_count={} first_index={} code={} message={}",
                    *yolox_evaluation_count,
                    batch.len(),
                    frames[0].frame.index,
                    error.code,
                    error.message
                ),
            );
            cancelled.store(true, Ordering::Relaxed);
            let _ = results.send(ObjectWorkerMsg::Error(error));
            false
        }
    }
}

pub(crate) fn spawn_object_worker(
    base_jobs: crossbeam_channel::Receiver<ObjectJob>,
    control_jobs: crossbeam_channel::Receiver<ObjectJob>,
    results: mpsc::Sender<ObjectWorkerMsg>,
    cancelled: Arc<AtomicBool>,
    yolox_model_path: std::path::PathBuf,
    yolox_fp16_path: std::path::PathBuf,
    pose_model_path: std::path::PathBuf,
    yolox_labels: Arc<Vec<String>>,
    pose_preprocess_time_us: Arc<AtomicU64>,
    worker_metrics: Arc<WorkerMetrics>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        diagnostics::append(
            "object-worker",
            &format!(
                "started yolox={} yolox_fp16={} pose={} max_batch={MAX_BATCH}",
                yolox_model_path.display(),
                yolox_fp16_path.display(),
                pose_model_path.display(),
            ),
        );
        let mut yolox_model: Option<NativeVisionModel> = None;
        let mut pose_model: Option<NativeVisionModel> = None;
        let mut pose_sample_index = 0usize;
        let mut previous_motion_frame: Option<Arc<AnalysisFrame>> = None;
        let mut pending_control_job: Option<ObjectJob> = None;
        let mut base_jobs_open = true;
        let mut control_jobs_open = true;
        let yolox_frame_elements = 3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
        let mut yolox_input = vec![114.0f32; MAX_BATCH * yolox_frame_elements];
        let mut yolox_output = Vec::with_capacity(1);
        let mut yolox_letterboxes = Vec::with_capacity(MAX_BATCH);
        let mut pose_input = vec![0.0f32; MOVENET_INPUT_SIZE * MOVENET_INPUT_SIZE * 3];
        let mut pose_output = Vec::with_capacity(1);
        let mut yolox_evaluation_count = 0usize;
        diagnostics::append(
            "object-worker",
            &format!(
                "allocated reusable yolox input bytes={}",
                yolox_input.len() * std::mem::size_of::<f32>()
            ),
        );

        let run_movenet = |frame: &AnalysisFrame,
                           pose_model: &mut Option<NativeVisionModel>,
                           pose_input: &mut Vec<f32>,
                           pose_output: &mut Vec<Vec<f32>>,
                           pose_preprocess_time_us: &AtomicU64| {
            let pose_preprocess_started = Instant::now();
            let letterbox = prepare_movenet_into(frame, pose_input);
            pose_preprocess_time_us.fetch_add(
                pose_preprocess_started.elapsed().as_micros() as u64,
                Ordering::Relaxed,
            );
            let pose_shape = [1, MOVENET_INPUT_SIZE as i64, MOVENET_INPUT_SIZE as i64, 3];
            let pose_started = Instant::now();
            let evaluated_pose = if let Some(current) = pose_model.as_mut() {
                current
                    .evaluate_into(&pose_shape, pose_input, pose_output)
                    .map(|()| current.device())
            } else {
                NativeVisionModel::create_into(
                    VisionModel::Pose,
                    &pose_model_path,
                    None,
                    "input",
                    &["output_0"],
                    &pose_shape,
                    pose_input,
                    pose_output,
                )
                .map(|created| {
                    let pose_device = created.device();
                    *pose_model = Some(created);
                    pose_device
                })
            };
            evaluated_pose.and_then(|pose_device| {
                if pose_output.len() != 1 {
                    return Err(NativeVisionError::new(
                        "tensor_contract_mismatch",
                        "MoveNet output count changed",
                        true,
                    ));
                }
                decode_movenet(&pose_output[0], letterbox)
                    .map(|poses| {
                        (
                            poses,
                            pose_device,
                            pose_started.elapsed().as_millis() as u64,
                        )
                    })
                    .map_err(|message| {
                        NativeVisionError::new("tensor_contract_mismatch", message, true)
                    })
            })
        };

        'jobs: while !cancelled.load(Ordering::Relaxed) {
            let first = match pending_control_job.take() {
                Some(job) => job,
                None => {
                    let mut selected = None;
                    if control_jobs_open {
                        match control_jobs.try_recv() {
                            Ok(job) => selected = Some(job),
                            Err(crossbeam_channel::TryRecvError::Disconnected) => {
                                control_jobs_open = false;
                            }
                            Err(crossbeam_channel::TryRecvError::Empty) => {}
                        }
                    }
                    if selected.is_none() {
                        selected = match (control_jobs_open, base_jobs_open) {
                            (true, true) => crossbeam_channel::select_biased! {
                                recv(control_jobs) -> message => match message {
                                    Ok(job) => Some(job),
                                    Err(_) => {
                                        control_jobs_open = false;
                                        continue 'jobs;
                                    }
                                },
                                recv(base_jobs) -> message => match message {
                                    Ok(job) => Some(job),
                                    Err(_) => {
                                        base_jobs_open = false;
                                        continue 'jobs;
                                    }
                                },
                            },
                            (true, false) => match control_jobs.recv() {
                                Ok(job) => Some(job),
                                Err(_) => {
                                    control_jobs_open = false;
                                    None
                                }
                            },
                            (false, true) => match base_jobs.recv() {
                                Ok(job) => Some(job),
                                Err(_) => {
                                    base_jobs_open = false;
                                    None
                                }
                            },
                            (false, false) => None,
                        };
                    }
                    let Some(job) = selected else {
                        break;
                    };
                    job
                }
            };

            match first.kind {
                ObjectJobKind::Base { .. } => {
                    let mut batch = vec![first];
                    while batch.len() < MAX_BATCH {
                        if !control_jobs.is_empty() {
                            break;
                        }
                        match base_jobs.try_recv() {
                            Ok(job) => batch.push(job),
                            Err(crossbeam_channel::TryRecvError::Disconnected) => {
                                base_jobs_open = false;
                                break;
                            }
                            Err(crossbeam_channel::TryRecvError::Empty) => break,
                        }
                    }
                    if !evaluate_object_detection_batch(
                        batch,
                        &base_jobs,
                        &mut yolox_evaluation_count,
                        &mut yolox_model,
                        &mut yolox_input,
                        &mut yolox_letterboxes,
                        &mut yolox_output,
                        &yolox_model_path,
                        &yolox_fp16_path,
                        &yolox_labels,
                        &results,
                        &cancelled,
                        &worker_metrics,
                    ) {
                        break 'jobs;
                    }
                }
                ObjectJobKind::Tile { .. } => {
                    let mut batch = vec![first];
                    while batch.len() < MAX_BATCH {
                        match control_jobs.try_recv() {
                            Ok(job) if matches!(&job.kind, ObjectJobKind::Tile { .. }) => {
                                batch.push(job);
                            }
                            Ok(job) => {
                                pending_control_job = Some(job);
                                break;
                            }
                            Err(crossbeam_channel::TryRecvError::Disconnected) => {
                                control_jobs_open = false;
                                break;
                            }
                            Err(crossbeam_channel::TryRecvError::Empty) => break,
                        }
                    }
                    if !evaluate_object_detection_batch(
                        batch,
                        &base_jobs,
                        &mut yolox_evaluation_count,
                        &mut yolox_model,
                        &mut yolox_input,
                        &mut yolox_letterboxes,
                        &mut yolox_output,
                        &yolox_model_path,
                        &yolox_fp16_path,
                        &yolox_labels,
                        &results,
                        &cancelled,
                        &worker_metrics,
                    ) {
                        break 'jobs;
                    }
                }
                ObjectJobKind::Finalize {
                    frame,
                    permit,
                    detections,
                    recovery_passes,
                    yolox_extra_ms,
                    yolox_duration_ms,
                    device,
                } => {
                    let motion_signal = if frame.scene_cut {
                        None
                    } else {
                        previous_motion_frame.as_ref().and_then(|previous| {
                            (previous.width == frame.width && previous.height == frame.height)
                                .then(|| {
                                    detect_motion_saliency(
                                        &previous.rgb,
                                        &frame.rgb,
                                        frame.width as usize,
                                        frame.height as usize,
                                    )
                                })
                                .flatten()
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

                    let (poses, pose_device, pose_duration_ms) = if should_run_pose {
                        match run_movenet(
                            &frame,
                            &mut pose_model,
                            &mut pose_input,
                            &mut pose_output,
                            &pose_preprocess_time_us,
                        ) {
                            Ok(value) => {
                                worker_metrics
                                    .base_pose_passes
                                    .fetch_add(1, Ordering::Relaxed);
                                worker_metrics
                                    .pose_base_inference_ms
                                    .fetch_add(value.2, Ordering::Relaxed);
                                value
                            }
                            Err(error) => {
                                cancelled.store(true, Ordering::Relaxed);
                                let _ = results.send(ObjectWorkerMsg::Error(error));
                                break;
                            }
                        }
                    } else {
                        (
                            Vec::new(),
                            pose_model
                                .as_ref()
                                .map(NativeVisionModel::device)
                                .unwrap_or(NativeVisionDevice::Cpu),
                            0,
                        )
                    };

                    let message = ObjectWorkerMsg::FinalizedBase(FinalizedObjectBase {
                        frame,
                        _permit: permit,
                        detections,
                        poses,
                        motion_signal,
                        device,
                        pose_device,
                        duration_ms: yolox_duration_ms + yolox_extra_ms,
                        pose_duration_ms,
                        recovery_passes,
                    });
                    if results.send(message).is_err() {
                        break;
                    }
                }
            }
        }
        diagnostics::append("object-worker", "stopped");
    })
}

/// Reorders pooled YOLOX base-pass results, recovering high-detail person
/// detections only after a base-pass loss, then publishes after MoveNet.
pub(crate) fn spawn_object_policy(
    incoming: mpsc::Receiver<ObjectWorkerMsg>,
    jobs: crossbeam_channel::Sender<ObjectJob>,
    results: mpsc::Sender<WorkerResult>,
    cancelled: Arc<AtomicBool>,
    vision_ablation: VisionAblationConfig,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reorder: BTreeMap<usize, BaseObjectOutcome> = BTreeMap::new();
        let mut next_index = 0usize;
        let mut finalized = 0usize;
        let mut total: Option<usize> = None;
        let mut yolox_recovery: Option<PendingObjectRecovery> = None;
        let mut waiting_finalize = false;
        let mut recovery_policy = RecoveryPolicy::default();
        recovery_policy.new_scene();
        let mut had_person_track = false;
        let mut recovery_person_box: Option<NormalizedBox> = None;

        let send_finalize =
            |outcome: BaseObjectOutcome,
             recovery_passes: usize,
             extra_ms: u64,
             jobs: &crossbeam_channel::Sender<ObjectJob>| {
                jobs.send(ObjectJob {
                    kind: ObjectJobKind::Finalize {
                        frame: outcome.frame,
                        permit: outcome.permit,
                        detections: outcome.detections,
                        recovery_passes,
                        yolox_extra_ms: extra_ms,
                        yolox_duration_ms: outcome.duration_ms,
                        device: outcome.device,
                    },
                })
            };

        'policy: while total != Some(finalized) {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let Ok(message) = incoming.recv() else {
                break;
            };
            match message {
                ObjectWorkerMsg::Total(count) => total = Some(count),
                ObjectWorkerMsg::Error(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    let _ = results.send(WorkerResult::Error(error));
                    break;
                }
                ObjectWorkerMsg::Base(outcome) => {
                    let index = outcome.frame.index;
                    reorder.insert(index, outcome);
                    if index == 0 || index % 128 == 0 {
                        diagnostics::append(
                            "object-policy",
                            &format!(
                                "base received index={index} next_index={next_index} finalized={finalized} reorder_len={} waiting_finalize={waiting_finalize}",
                                reorder.len(),
                            ),
                        );
                    }
                }
                ObjectWorkerMsg::Tile {
                    base_index,
                    detections,
                    duration_ms,
                } => {
                    let Some(pending) = yolox_recovery.as_mut() else {
                        continue;
                    };
                    debug_assert_eq!(pending.base.frame.index, base_index);
                    pending.collected.extend(detections);
                    pending.extra_duration_ms += duration_ms;
                    pending.remaining -= 1;
                    if pending.remaining == 0 {
                        let mut done = yolox_recovery.take().expect("checked pending recovery");
                        let mut merged = std::mem::take(&mut done.base.detections);
                        merged.append(&mut done.collected);
                        done.base.detections = merge_subject_detections(merged, 0.45);
                        if let Some(box_) = strongest_person_box(&done.base.detections) {
                            recovery_person_box = Some(box_);
                            had_person_track = true;
                        }
                        diagnostics::append(
                            "object-policy",
                            &format!(
                                "tile merge complete frame={} tile_passes={} detections={}",
                                done.base.frame.index,
                                done.pass_count,
                                done.base.detections.len(),
                            ),
                        );
                        if send_finalize(done.base, done.pass_count, done.extra_duration_ms, &jobs)
                            .is_err()
                        {
                            cancelled.store(true, Ordering::Relaxed);
                            break 'policy;
                        }
                        waiting_finalize = true;
                    }
                }
                ObjectWorkerMsg::FinalizedBase(outcome) => {
                    waiting_finalize = false;
                    if results
                        .send(WorkerResult::Object(object_result_from(outcome)))
                        .is_err()
                    {
                        break 'policy;
                    }
                    finalized += 1;
                    next_index += 1;
                    if finalized == 1 || finalized % 64 == 0 {
                        diagnostics::append(
                            "object-policy",
                            &format!(
                                "finalized={finalized} next_index={next_index} reorder_len={} waiting_finalize={waiting_finalize}",
                                reorder.len(),
                            ),
                        );
                    }
                }
            }

            while !waiting_finalize && yolox_recovery.is_none() {
                let Some(outcome) = reorder.remove(&next_index) else {
                    break;
                };
                if outcome.frame.scene_cut {
                    recovery_policy.new_scene();
                    had_person_track = false;
                    recovery_person_box = None;
                }
                let current_person_box = strongest_person_box(&outcome.detections);
                let has_continuous_person = current_person_box
                    .zip(recovery_person_box)
                    .map_or(false, |(current, previous)| {
                        box_iou(current, previous) >= RECOVERY_CONTINUITY_IOU
                    });
                let recover_person = recovery_policy.observe(
                    outcome.frame.time,
                    outcome.frame.face_bucket,
                    has_continuous_person,
                    current_person_box.is_some() && !has_continuous_person,
                    had_person_track,
                );
                if should_schedule_object_recovery(recover_person, vision_ablation) {
                    let tiles = quality_object_tiles(&outcome.frame);
                    let tile_count = tiles.len();
                    if tile_count > 0 {
                        diagnostics::append(
                            "object-policy",
                            &format!(
                                "high-detail tiling frame={} source={}x{} tiles={tile_count} reason=person-continuity-loss",
                                outcome.frame.index, outcome.frame.width, outcome.frame.height,
                            ),
                        );
                        for tile in tiles {
                            let job = ObjectJob {
                                kind: ObjectJobKind::Tile {
                                    frame: outcome.frame.clone(),
                                    region: Some(tile.region),
                                    base_index: outcome.frame.index,
                                    offset_x: tile.offset_x,
                                    offset_y: tile.offset_y,
                                    span_x: tile.span_x,
                                    span_y: tile.span_y,
                                },
                            };
                            if jobs.send(job).is_err() {
                                cancelled.store(true, Ordering::Relaxed);
                                break 'policy;
                            }
                        }
                        yolox_recovery = Some(PendingObjectRecovery {
                            base: outcome,
                            collected: Vec::new(),
                            remaining: tile_count,
                            pass_count: tile_count,
                            extra_duration_ms: 0,
                        });
                        break;
                    }
                }
                if let Some(box_) = current_person_box {
                    // A discontinuous candidate is kept out of the recovery
                    // state until a tiled pass confirms it. Otherwise a
                    // sequence of unrelated raw boxes can suppress recovery.
                    if recovery_person_box.is_none() || has_continuous_person {
                        recovery_person_box = Some(box_);
                    }
                    had_person_track = true;
                }
                if send_finalize(outcome, 0, 0, &jobs).is_err() {
                    cancelled.store(true, Ordering::Relaxed);
                    break 'policy;
                }
                waiting_finalize = true;
                break;
            }
        }
    })
}

#[cfg(test)]
mod ablation_tests {
    use super::*;

    #[test]
    fn each_ablation_only_blocks_its_recovery_queue() {
        let face = VisionAblationConfig {
            disable_face_tile_recovery: true,
            ..Default::default()
        };
        assert!(!should_schedule_face_recovery(true, face));
        assert!(should_schedule_object_recovery(true, face));

        let object = VisionAblationConfig {
            disable_object_tile_recovery: true,
            ..Default::default()
        };
        assert!(should_schedule_face_recovery(true, object));
        assert!(!should_schedule_object_recovery(true, object));
    }
}
