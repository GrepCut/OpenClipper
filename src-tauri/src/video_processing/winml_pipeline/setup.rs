use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{mpsc, Arc};
use std::thread;

use super::super::generalization_shadow::{GeneralizationShadowConfig, GeneralizationShadowRunner};
use super::super::winml_internal::{
    AnalysisFrame, FACE_WORKERS, FaceJob, FaceWorkerMsg, OBJECT_WORKERS, QUEUE_CAPACITY,
    WorkerResult,
};
use super::super::winml_vision::{fp16_variant_path, resource_paths, NativeVisionError};
use super::super::winml_workers::{spawn_face_policy, spawn_face_worker, spawn_object_worker};
use super::types::NativeVisionProgress;

pub(crate) struct PipelineInit {
    pub setup: PipelineSetup,
    pub shadow_runner: GeneralizationShadowRunner,
}

pub(crate) struct PipelineSetup {
    pub face_msg_sender: mpsc::Sender<FaceWorkerMsg>,
    pub face_job_sender: crossbeam_channel::Sender<FaceJob>,
    pub object_sender: crossbeam_channel::Sender<Arc<AnalysisFrame>>,
    pub result_receiver: mpsc::Receiver<WorkerResult>,
    pub face_workers: Vec<thread::JoinHandle<()>>,
    pub object_workers: Vec<thread::JoinHandle<()>>,
    pub face_policy: thread::JoinHandle<()>,
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
        let yolox_labels_path = resources.yolox_labels;
        let shadow_config = GeneralizationShadowConfig::resolve();
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
            queued_detections: 0,
        })?;

        let face_fp16_path = fp16_variant_path(&face_model_path);
        let face_preprocess_time_us = Arc::new(AtomicU64::new(0));
        let pose_preprocess_time_us = Arc::new(AtomicU64::new(0));
        let yolox_labels: Arc<Vec<String>> = Arc::new(yolox_labels);
        let (face_job_sender, face_job_receiver) =
            crossbeam_channel::bounded::<FaceJob>(QUEUE_CAPACITY);
        let (object_sender, object_receiver) =
            crossbeam_channel::bounded::<Arc<AnalysisFrame>>(QUEUE_CAPACITY);
        let (result_sender, result_receiver) = mpsc::channel();
        let (face_msg_sender, face_msg_receiver) = mpsc::channel();
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
        let object_workers: Vec<_> = (0..OBJECT_WORKERS)
            .map(|_| {
                spawn_object_worker(
                    object_receiver.clone(),
                    result_sender.clone(),
                    cancelled.clone(),
                    yolox_model_path.clone(),
                    pose_model_path.clone(),
                    yolox_labels.clone(),
                    pose_preprocess_time_us.clone(),
                )
            })
            .collect();
        drop(face_job_receiver);
        drop(object_receiver);
        let face_policy = spawn_face_policy(
            face_msg_receiver,
            face_job_sender.clone(),
            result_sender,
            cancelled,
        );

        Ok(PipelineInit {
            setup: PipelineSetup {
                face_msg_sender,
                face_job_sender,
                object_sender,
                result_receiver,
                face_workers,
                object_workers,
                face_policy,
                face_preprocess_time_us,
                pose_preprocess_time_us,
            },
            shadow_runner,
        })
    }
}
