use std::collections::BTreeMap;
use std::time::Instant;

use super::super::bytetrack::ByteTracker;
use super::super::generalization_shadow::GeneralizationShadowRunner;
use super::super::vision_logic::{box_iou, SubjectDetection};
use super::super::winml_internal::{FaceResult, ObjectResult};
use super::super::winml_tracking::{
    face_track_inputs, padded_face_box, pose_track_inputs, subject_track_inputs, tracked_faces,
    tracked_poses, tracked_subjects,
};
use super::super::winml_vision::{NativeVisionDevice, NativeVisionError};
use super::types::{
    NativeFaceSample, NativeImportanceSignalRegion, NativeSubjectSample, NativeVisionProgress,
};

pub(crate) struct MergeOutput {
    pub face_samples: Vec<NativeFaceSample>,
    pub subject_samples: Vec<NativeSubjectSample>,
    pub face_device: NativeVisionDevice,
    pub object_device: NativeVisionDevice,
    pub pose_device: NativeVisionDevice,
    pub face_inference_ms: u64,
    pub object_inference_ms: u64,
    pub pose_inference_ms: u64,
    pub recovery_face_passes: usize,
    pub tracker_duration_ms: u64,
    pub tracked_subject_count: usize,
    pub predicted_subject_count: usize,
    pub inference_duration_ms: u64,
}

pub(crate) fn merge_samples(
    sample_count: usize,
    mut face_results: BTreeMap<usize, FaceResult>,
    mut object_results: BTreeMap<usize, ObjectResult>,
    shadow_runner: &mut GeneralizationShadowRunner,
    tracking_enabled: bool,
    progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<MergeOutput, NativeVisionError> {
    let preserve_raw_pose_observations = sample_count > 0
        && object_results
            .values()
            .filter(|result| !result.poses.is_empty())
            .count()
            * 10
            >= sample_count * 3
        && face_results
            .values()
            .filter(|result| !result.faces.is_empty())
            .count()
            * 10
            < sample_count * 3;

    let mut face_samples = Vec::new();
    let mut subject_samples = Vec::with_capacity(sample_count);
    let mut face_device = NativeVisionDevice::Cpu;
    let mut object_device = NativeVisionDevice::Cpu;
    let mut pose_device = NativeVisionDevice::Cpu;
    let mut face_inference_ms = 0;
    let mut object_inference_ms = 0;
    let mut pose_inference_ms = 0;
    let mut recovery_face_passes = 0;
    let tracker_started = Instant::now();
    let mut object_tracker = ByteTracker::new();
    let mut face_tracker = ByteTracker::new();
    let mut pose_tracker = ByteTracker::new();
    let mut tracked_subject_count = 0usize;
    let mut predicted_subject_count = 0usize;
    for index in 0..sample_count {
        let face = face_results
            .remove(&index)
            .expect("validated ordered face result");
        let object = object_results
            .remove(&index)
            .expect("validated ordered object result");
        face_device = face.device;
        object_device = object.device;
        pose_device = object.pose_device;
        face_inference_ms += face.duration_ms;
        recovery_face_passes += face.recovery_passes;
        object_inference_ms += object.duration_ms;
        pose_inference_ms += object.pose_duration_ms;
        if tracking_enabled && face.scene_cut {
            object_tracker.reset();
            face_tracker.reset();
            pose_tracker.reset();
        }
        let autoflip_faces = if tracking_enabled {
            tracked_faces(
                face_tracker.update(face.time, &face_track_inputs(&face.faces)),
                &face.faces,
            )
        } else {
            face.faces
                .iter()
                .filter(|item| item.score >= 0.6)
                .cloned()
                .collect()
        };
        let pose_subjects = if tracking_enabled {
            if preserve_raw_pose_observations {
                object.poses
            } else {
                tracked_poses(
                    pose_tracker.update(object.time, &pose_track_inputs(&object.poses)),
                    &object.poses,
                )
            }
        } else {
            object.poses.clone()
        };
        let (mut detections, camera_motion_residual) = if tracking_enabled {
            let tracked = tracked_subjects(
                object_tracker.update(object.time, &subject_track_inputs(&object.detections)),
            );
            tracked_subject_count += tracked.len();
            predicted_subject_count += tracked
                .iter()
                .filter(|item| item.predicted == Some(true))
                .count();
            (tracked, Some(object_tracker.last_camera_motion()))
        } else {
            (object.detections, None)
        };
        for pose in pose_subjects
            .iter()
            .filter(|pose| pose.predicted != Some(true) && pose.track_id.is_some())
        {
            let overlaps_person = detections.iter().any(|detection| {
                detection.label.eq_ignore_ascii_case("person")
                    && box_iou(detection.box_, pose.box_) >= 0.5
            });
            if !overlaps_person {
                detections.push(SubjectDetection {
                    box_: pose.box_,
                    label: "person".into(),
                    score: pose.score,
                    track_id: pose.track_id,
                    predicted: pose.predicted,
                    detector_source: Some("pose"),
                });
            }
        }
        let person_boxes: Vec<_> = detections
            .iter()
            .filter(|item| item.label.eq_ignore_ascii_case("person"))
            .collect();
        let person_box = person_boxes
            .iter()
            .max_by(|left, right| {
                left.score
                    .partial_cmp(&right.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|item| item.box_);
        let reid_embedding =
            shadow_runner.record_reid_context(object.time, person_boxes.len(), person_box);
        let mut importance_signals: Vec<NativeImportanceSignalRegion> = object
            .motion_signal
            .into_iter()
            .map(|(box_, confidence)| NativeImportanceSignalRegion {
                box_,
                kind: "motion",
                confidence,
            })
            .collect();
        if let Some(saliency) = shadow_runner.latest_saliency() {
            importance_signals.push(NativeImportanceSignalRegion {
                box_: saliency.box_,
                kind: "video-saliency",
                confidence: saliency.confidence,
            });
        }
        let subject = NativeSubjectSample {
            time: object.time,
            detections,
            autoflip_faces,
            pose_subjects,
            importance_signals,
            model_id: "clipper-vision-v3-yolox",
            scene_cut: face.scene_cut.then_some(true),
            camera_motion_residual,
            reid_embedding,
        };
        let face_sample = face.face_bucket.then(|| NativeFaceSample {
            time: face.time,
            faces: face
                .faces
                .iter()
                .map(|item| padded_face_box(item, face.display_width, face.display_height))
                .collect(),
            frame_w: face.display_width,
            frame_h: face.display_height,
            scene_cut: face.scene_cut.then_some(true),
        });
        if let Some(sample) = face_sample.clone() {
            face_samples.push(sample);
        }
        subject_samples.push(subject.clone());
        let percent = 90 + ((index + 1) * 10 / sample_count.max(1));
        progress(NativeVisionProgress {
            phase: "inferencing",
            percent,
            timestamp_sec: face.time,
            eta_seconds: None,
            face_sample,
            subject_sample: Some(subject),
            queued_detections: sample_count - index - 1,
        })?;
    }
    let tracker_duration_ms = tracking_enabled
        .then(|| tracker_started.elapsed().as_millis() as u64)
        .unwrap_or(0);
    let inference_duration_ms = face_inference_ms.max(object_inference_ms + pose_inference_ms);
    Ok(MergeOutput {
        face_samples,
        subject_samples,
        face_device,
        object_device,
        pose_device,
        face_inference_ms,
        object_inference_ms,
        pose_inference_ms,
        recovery_face_passes,
        tracker_duration_ms,
        tracked_subject_count,
        predicted_subject_count,
        inference_duration_ms,
    })
}
