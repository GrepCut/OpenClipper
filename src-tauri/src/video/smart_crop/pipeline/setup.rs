use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{mpsc, Arc};
use std::thread;

use super::super::diagnostics;
use super::super::internal::{
    FaceJob, FaceWorkerMsg, ObjectJob, ObjectWorkerMsg, FACE_WORKERS, OBJECT_FRAME_CAPACITY,
    OBJECT_WORKERS, QUEUE_CAPACITY,
};
use super::super::shadow::{GeneralizationShadowConfig, GeneralizationShadowRunner};
use super::super::vision::{fp16_variant_path, resource_paths, NativeVisionError};
use super::super::workers::{
    spawn_face_policy, spawn_face_worker, spawn_object_policy, spawn_object_worker,
};
use super::spool::{spawn_result_spooler, SpoolOutput};
use super::types::NativeVisionProgress;

pub(crate) struct PipelineInit {
    pub setup: PipelineSetup,
    pub shadow_runner: GeneralizationShadowRunner,
}

pub(crate) struct PipelineSetup {
    pub face_msg_sender: mpsc::Sender<FaceWorkerMsg>,
    pub face_job_sender: crossbeam_channel::Sender<FaceJob>,
    pub object_base_job_sender: crossbeam_channel::Sender<ObjectJob>,
    pub object_control_job_sender: crossbeam_channel::Sender<ObjectJob>,
    pub object_frame_permit_sender: crossbeam_channel::Sender<()>,
    pub object_frame_permit_receiver: crossbeam_channel::Receiver<()>,
    pub object_msg_sender: mpsc::Sender<ObjectWorkerMsg>,
    pub result_spooler: thread::JoinHandle<Result<SpoolOutput, NativeVisionError>>,
    pub face_workers: Vec<thread::JoinHandle<()>>,
    pub object_workers: Vec<thread::JoinHandle<()>>,
    pub face_policy: thread::JoinHandle<()>,
    pub object_policy: thread::JoinHandle<()>,
    pub face_preprocess_time_us: Arc<AtomicU64>,
    pub pose_preprocess_time_us: Arc<AtomicU64>,
}

impl PipelineSetup {
    pub(crate) fn prepare(
        resource_dir: &Path,
        cancelled: Arc<AtomicBool>,
        progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
    ) -> Result<PipelineInit, NativeVisionError> {
        let resources = resource_paths(resource_dir);
        let face_model_path = resources.face;
        let pose_model_path = resources.pose;
        let yolox_model_path = resources.yolox;
        let yolox_fp16_path = fp16_variant_path(&yolox_model_path);
        let yolox_labels_path = resources.yolox_labels;
        let shadow_config = GeneralizationShadowConfig::resolve();
        diagnostics::append(
            "setup",
            &format!(
                "models face={} face_fp16={} yolox={} yolox_fp16={} pose={} labels={}",
                face_model_path.display(),
                fp16_variant_path(&face_model_path).display(),
                yolox_model_path.display(),
                yolox_fp16_path.display(),
                pose_model_path.display(),
                yolox_labels_path.display(),
            ),
        );
        let shadow_runner = GeneralizationShadowRunner::open(
            shadow_config,
            &resources.transnet,
            &resources.osnet,
            &resources.vinet,
        );
        for path in [
            &face_model_path,
            &pose_model_path,
            &yolox_model_path,
            &yolox_labels_path,
        ] {
            if !path.is_file() {
                diagnostics::append(
                    "setup",
                    &format!("MISSING model resource={}", path.display()),
                );
                return Err(NativeVisionError::new(
                    "model_missing",
                    format!("Missing resource {}", path.display()),
                    false,
                ));
            }
        }
        let yolox_labels = std::fs::read_to_string(&yolox_labels_path)
            .map_err(|error| {
                NativeVisionError::new(
                    "model_missing",
                    format!("Cannot read YOLOX labels: {error}"),
                    false,
                )
            })?
            .lines()
            .map(str::trim)
            .map(str::to_owned)
            .collect();

        progress(NativeVisionProgress {
            phase: "initializing",
            percent: 0,
            timestamp_sec: 0.0,
            eta_seconds: None,
            face_sample: None,
            subject_sample: None,
            face_samples: None,
            subject_samples: None,
            queued_detections: 0,
        })?;

        let face_fp16_path = fp16_variant_path(&face_model_path);
        let face_preprocess_time_us = Arc::new(AtomicU64::new(0));
        let pose_preprocess_time_us = Arc::new(AtomicU64::new(0));
        let yolox_labels: Arc<Vec<String>> = Arc::new(yolox_labels);
        let (face_job_sender, face_job_receiver) =
            crossbeam_channel::bounded::<FaceJob>(QUEUE_CAPACITY);
        let (object_base_job_sender, object_base_job_receiver) =
            crossbeam_channel::bounded::<ObjectJob>(QUEUE_CAPACITY);
        let (object_control_job_sender, object_control_job_receiver) =
            crossbeam_channel::bounded::<ObjectJob>(QUEUE_CAPACITY);
        let (object_frame_permit_sender, object_frame_permit_receiver) =
            crossbeam_channel::bounded::<()>(OBJECT_FRAME_CAPACITY);
        for _ in 0..OBJECT_FRAME_CAPACITY {
            object_frame_permit_sender
                .send(())
                .expect("new object-frame permit channel is connected");
        }
        let (result_sender, result_receiver) = mpsc::channel();
        // Drain result objects continuously to disk while FFmpeg is decoding.
        // This replaces the former unbounded in-memory receiver.
        let result_spooler = spawn_result_spooler(result_receiver);
        let (face_msg_sender, face_msg_receiver) = mpsc::channel();
        let (object_msg_sender, object_msg_receiver) = mpsc::channel();
        let face_workers: Vec<_> = (0..FACE_WORKERS)
            .map(|_| {
                spawn_face_worker(
                    face_job_receiver.clone(),
                    face_msg_sender.clone(),
                    cancelled.clone(),
                    face_model_path.clone(),
                    face_fp16_path.clone(),
                    face_preprocess_time_us.clone(),
                )
            })
            .collect();
        diagnostics::append("setup", &format!("spawned face_workers={FACE_WORKERS}"));
        let object_workers: Vec<_> = (0..OBJECT_WORKERS)
            .map(|_| {
                spawn_object_worker(
                    object_base_job_receiver.clone(),
                    object_control_job_receiver.clone(),
                    object_msg_sender.clone(),
                    cancelled.clone(),
                    yolox_model_path.clone(),
                    yolox_fp16_path.clone(),
                    pose_model_path.clone(),
                    yolox_labels.clone(),
                    pose_preprocess_time_us.clone(),
                )
            })
            .collect();
        diagnostics::append(
            "setup",
            &format!(
                "spawned object_workers={OBJECT_WORKERS} base_queue_capacity={QUEUE_CAPACITY} control_queue_capacity={QUEUE_CAPACITY} frame_lifecycle_capacity={OBJECT_FRAME_CAPACITY}"
            ),
        );
        drop(face_job_receiver);
        drop(object_base_job_receiver);
        drop(object_control_job_receiver);
        let face_policy = spawn_face_policy(
            face_msg_receiver,
            face_job_sender.clone(),
            result_sender.clone(),
            cancelled.clone(),
        );
        let object_policy = spawn_object_policy(
            object_msg_receiver,
            object_control_job_sender.clone(),
            result_sender,
            cancelled,
        );

        Ok(PipelineInit {
            setup: PipelineSetup {
                face_msg_sender,
                face_job_sender,
                object_base_job_sender,
                object_control_job_sender,
                object_frame_permit_sender,
                object_frame_permit_receiver,
                object_msg_sender,
                result_spooler,
                face_workers,
                object_workers,
                face_policy,
                object_policy,
                face_preprocess_time_us,
                pose_preprocess_time_us,
            },
            shadow_runner,
        })
    }
}
