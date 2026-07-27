//! Bounded, disk-backed hand-off between GPU workers and tracking.
//!
//! Keeping all worker results in an unbounded channel made memory grow with
//! video duration.  The writer starts before decoding and therefore applies
//! backpressure only to disk I/O, never to accumulated RAM.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::thread;

use uuid::Uuid;

use super::super::diagnostics;
use super::super::internal::{FaceResult, ObjectResult, WorkerResult};
use super::super::vision::{NativeVisionDevice, NativeVisionError};
use super::super::vision_logic::{
    AutoFlipFaceDetection, Keypoint, NormalizedBox, PoseSubject, SubjectDetection,
};

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpoolFaceDetection {
    #[serde(rename = "box")]
    box_: NormalizedBox,
    keypoints: Vec<Keypoint>,
    track_id: Option<u64>,
    predicted: Option<bool>,
    score: f32,
}

impl From<AutoFlipFaceDetection> for SpoolFaceDetection {
    fn from(value: AutoFlipFaceDetection) -> Self {
        Self {
            box_: value.box_,
            keypoints: value.keypoints,
            track_id: value.track_id,
            predicted: value.predicted,
            score: value.score,
        }
    }
}

impl From<SpoolFaceDetection> for AutoFlipFaceDetection {
    fn from(value: SpoolFaceDetection) -> Self {
        Self {
            box_: value.box_,
            keypoints: value.keypoints,
            track_id: value.track_id,
            predicted: value.predicted,
            score: value.score,
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum SpoolDetectorSource {
    YoloX,
    Pose,
}

impl SpoolDetectorSource {
    fn from_domain(value: &'static str) -> Result<Self, NativeVisionError> {
        match value {
            "yolox" => Ok(Self::YoloX),
            "pose" => Ok(Self::Pose),
            other => Err(invalid_spool_value(format!(
                "Unknown detector source while writing analysis spool: {other}"
            ))),
        }
    }

    fn into_domain(self) -> &'static str {
        match self {
            Self::YoloX => "yolox",
            Self::Pose => "pose",
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpoolSubjectDetection {
    #[serde(rename = "box")]
    box_: NormalizedBox,
    label: String,
    score: f32,
    track_id: Option<u64>,
    predicted: Option<bool>,
    detector_source: Option<SpoolDetectorSource>,
}

impl TryFrom<SubjectDetection> for SpoolSubjectDetection {
    type Error = NativeVisionError;

    fn try_from(value: SubjectDetection) -> Result<Self, Self::Error> {
        Ok(Self {
            box_: value.box_,
            label: value.label,
            score: value.score,
            track_id: value.track_id,
            predicted: value.predicted,
            detector_source: value
                .detector_source
                .map(SpoolDetectorSource::from_domain)
                .transpose()?,
        })
    }
}

impl From<SpoolSubjectDetection> for SubjectDetection {
    fn from(value: SpoolSubjectDetection) -> Self {
        Self {
            box_: value.box_,
            label: value.label,
            score: value.score,
            track_id: value.track_id,
            predicted: value.predicted,
            detector_source: value.detector_source.map(SpoolDetectorSource::into_domain),
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpoolPoseSubject {
    #[serde(rename = "box")]
    box_: NormalizedBox,
    score: f32,
    track_id: Option<u64>,
    predicted: Option<bool>,
    head_box: Option<NormalizedBox>,
    torso_box: Option<NormalizedBox>,
    trackable: bool,
}

impl From<PoseSubject> for SpoolPoseSubject {
    fn from(value: PoseSubject) -> Self {
        Self {
            box_: value.box_,
            score: value.score,
            track_id: value.track_id,
            predicted: value.predicted,
            head_box: value.head_box,
            torso_box: value.torso_box,
            trackable: value.trackable,
        }
    }
}

impl From<SpoolPoseSubject> for PoseSubject {
    fn from(value: SpoolPoseSubject) -> Self {
        Self {
            box_: value.box_,
            score: value.score,
            track_id: value.track_id,
            predicted: value.predicted,
            head_box: value.head_box,
            torso_box: value.torso_box,
            trackable: value.trackable,
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpoolFaceResult {
    index: usize,
    time: f64,
    faces: Vec<SpoolFaceDetection>,
    display_width: u32,
    display_height: u32,
    face_bucket: bool,
    scene_cut: bool,
    device: NativeVisionDevice,
    duration_ms: u64,
    recovery_passes: usize,
}

impl From<FaceResult> for SpoolFaceResult {
    fn from(value: FaceResult) -> Self {
        Self {
            index: value.index,
            time: value.time,
            faces: value.faces.into_iter().map(Into::into).collect(),
            display_width: value.display_width,
            display_height: value.display_height,
            face_bucket: value.face_bucket,
            scene_cut: value.scene_cut,
            device: value.device,
            duration_ms: value.duration_ms,
            recovery_passes: value.recovery_passes,
        }
    }
}

impl From<SpoolFaceResult> for FaceResult {
    fn from(value: SpoolFaceResult) -> Self {
        Self {
            index: value.index,
            time: value.time,
            faces: value.faces.into_iter().map(Into::into).collect(),
            display_width: value.display_width,
            display_height: value.display_height,
            face_bucket: value.face_bucket,
            scene_cut: value.scene_cut,
            device: value.device,
            duration_ms: value.duration_ms,
            recovery_passes: value.recovery_passes,
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SpoolObjectResult {
    index: usize,
    time: f64,
    detections: Vec<SpoolSubjectDetection>,
    poses: Vec<SpoolPoseSubject>,
    motion_signal: Option<(NormalizedBox, f32)>,
    device: NativeVisionDevice,
    pose_device: NativeVisionDevice,
    duration_ms: u64,
    pose_duration_ms: u64,
    recovery_passes: usize,
    recovery_pose_passes: usize,
}

impl TryFrom<ObjectResult> for SpoolObjectResult {
    type Error = NativeVisionError;

    fn try_from(value: ObjectResult) -> Result<Self, Self::Error> {
        Ok(Self {
            index: value.index,
            time: value.time,
            detections: value
                .detections
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            poses: value.poses.into_iter().map(Into::into).collect(),
            motion_signal: value.motion_signal,
            device: value.device,
            pose_device: value.pose_device,
            duration_ms: value.duration_ms,
            pose_duration_ms: value.pose_duration_ms,
            recovery_passes: value.recovery_passes,
            recovery_pose_passes: value.recovery_pose_passes,
        })
    }
}

impl From<SpoolObjectResult> for ObjectResult {
    fn from(value: SpoolObjectResult) -> Self {
        Self {
            index: value.index,
            time: value.time,
            detections: value.detections.into_iter().map(Into::into).collect(),
            poses: value.poses.into_iter().map(Into::into).collect(),
            motion_signal: value.motion_signal,
            device: value.device,
            pose_device: value.pose_device,
            duration_ms: value.duration_ms,
            pose_duration_ms: value.pose_duration_ms,
            recovery_passes: value.recovery_passes,
            recovery_pose_passes: value.recovery_pose_passes,
        }
    }
}

fn invalid_spool_value(message: impl Into<String>) -> NativeVisionError {
    NativeVisionError::new("analysis_storage_failed", message, true)
}

fn write_face_record(writer: &mut impl Write, value: FaceResult) -> Result<(), NativeVisionError> {
    serde_json::to_writer(writer, &SpoolFaceResult::from(value))
        .map_err(|error| invalid_spool_value(format!("Cannot write face spool: {error}")))
}

fn write_object_record(
    writer: &mut impl Write,
    value: ObjectResult,
) -> Result<(), NativeVisionError> {
    let value = SpoolObjectResult::try_from(value)?;
    serde_json::to_writer(writer, &value)
        .map_err(|error| invalid_spool_value(format!("Cannot write object spool: {error}")))
}

pub(crate) fn decode_face_record(line: &str) -> Result<FaceResult, NativeVisionError> {
    serde_json::from_str::<SpoolFaceResult>(line)
        .map(Into::into)
        .map_err(|error| invalid_spool_value(format!("Cannot parse face analysis spool: {error}")))
}

pub(crate) fn decode_object_record(line: &str) -> Result<ObjectResult, NativeVisionError> {
    serde_json::from_str::<SpoolObjectResult>(line)
        .map(Into::into)
        .map_err(|error| {
            invalid_spool_value(format!("Cannot parse object analysis spool: {error}"))
        })
}

pub(crate) struct SpoolOutput {
    pub face_path: PathBuf,
    pub object_path: PathBuf,
    pub face_count: usize,
    pub object_count: usize,
    pub face_nonempty_count: usize,
    pub pose_nonempty_count: usize,
}

impl SpoolOutput {
    pub(crate) fn cleanup(&self) {
        if let Some(directory) = self.face_path.parent() {
            if directory.exists() {
                if let Err(error) = fs::remove_dir_all(directory) {
                    diagnostics::append(
                        "spool",
                        &format!("cleanup failed path={} error={error}", directory.display()),
                    );
                }
            }
        }
    }
}

impl Drop for SpoolOutput {
    fn drop(&mut self) {
        self.cleanup();
    }
}

pub(crate) fn spawn_result_spooler(
    receiver: Receiver<WorkerResult>,
) -> thread::JoinHandle<Result<SpoolOutput, NativeVisionError>> {
    thread::spawn(move || {
        let directory = std::env::temp_dir()
            .join("open-clipper-vision")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).map_err(|error| {
            NativeVisionError::new(
                "analysis_storage_failed",
                format!("Cannot create analysis spool: {error}"),
                true,
            )
        })?;
        let face_path = directory.join("faces.ndjson");
        let object_path = directory.join("objects.ndjson");
        let mut faces = BufWriter::new(File::create(&face_path).map_err(|error| {
            NativeVisionError::new(
                "analysis_storage_failed",
                format!("Cannot create face spool: {error}"),
                true,
            )
        })?);
        let mut objects = BufWriter::new(File::create(&object_path).map_err(|error| {
            NativeVisionError::new(
                "analysis_storage_failed",
                format!("Cannot create object spool: {error}"),
                true,
            )
        })?);
        diagnostics::append("spool", &format!("started path={}", directory.display()));
        let mut first_error = None;
        let mut face_count: usize = 0;
        let mut object_count: usize = 0;
        let mut face_nonempty_count: usize = 0;
        let mut pose_nonempty_count: usize = 0;
        for result in receiver {
            match result {
                WorkerResult::Face(value) => {
                    face_count += 1;
                    face_nonempty_count += usize::from(!value.faces.is_empty());
                    write_face_record(&mut faces, value)?;
                    faces.write_all(b"\n").map_err(|error| {
                        NativeVisionError::new(
                            "analysis_storage_failed",
                            format!("Cannot finish face spool record: {error}"),
                            true,
                        )
                    })?;
                    if face_count % 128 == 0 {
                        diagnostics::append(
                            "spool",
                            &format!(
                                "progress face_results={face_count} object_results={object_count} delta={} resources={}",
                                face_count.saturating_sub(object_count),
                                diagnostics::resource_snapshot(),
                            ),
                        );
                    }
                }
                WorkerResult::Object(value) => {
                    object_count += 1;
                    pose_nonempty_count += usize::from(!value.poses.is_empty());
                    write_object_record(&mut objects, value)?;
                    objects.write_all(b"\n").map_err(|error| {
                        NativeVisionError::new(
                            "analysis_storage_failed",
                            format!("Cannot finish object spool record: {error}"),
                            true,
                        )
                    })?;
                    if object_count % 128 == 0 {
                        diagnostics::append(
                            "spool",
                            &format!(
                                "progress face_results={face_count} object_results={object_count} delta={} resources={}",
                                face_count.saturating_sub(object_count),
                                diagnostics::resource_snapshot(),
                            ),
                        );
                    }
                }
                WorkerResult::Error(error) if first_error.is_none() => first_error = Some(error),
                WorkerResult::Error(_) => {}
            }
        }
        faces.flush().map_err(|error| {
            NativeVisionError::new(
                "analysis_storage_failed",
                format!("Cannot flush face spool: {error}"),
                true,
            )
        })?;
        objects.flush().map_err(|error| {
            NativeVisionError::new(
                "analysis_storage_failed",
                format!("Cannot flush object spool: {error}"),
                true,
            )
        })?;
        if let Some(error) = first_error {
            return Err(error);
        }
        diagnostics::append(
            "spool",
            &format!("complete face_results={face_count} object_results={object_count}"),
        );
        Ok(SpoolOutput {
            face_path,
            object_path,
            face_count,
            object_count,
            face_nonempty_count,
            pose_nonempty_count,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn box_(x: f32) -> NormalizedBox {
        NormalizedBox {
            x,
            y: 0.2,
            width: 0.3,
            height: 0.4,
        }
    }

    #[test]
    fn face_record_round_trip_preserves_internal_tracker_score() {
        let input = FaceResult {
            index: 7,
            time: 1.4,
            faces: vec![AutoFlipFaceDetection {
                box_: box_(0.1),
                keypoints: vec![Keypoint { x: 0.2, y: 0.3 }],
                track_id: Some(11),
                predicted: Some(true),
                score: 0.875,
            }],
            display_width: 1920,
            display_height: 1080,
            face_bucket: true,
            scene_cut: false,
            device: NativeVisionDevice::DirectXHighPerformance,
            duration_ms: 9,
            recovery_passes: 2,
        };
        let mut encoded = Vec::new();
        write_face_record(&mut encoded, input).unwrap();
        let decoded = decode_face_record(std::str::from_utf8(&encoded).unwrap()).unwrap();

        assert_eq!(decoded.index, 7);
        assert_eq!(decoded.faces[0].score, 0.875);
        assert_eq!(decoded.faces[0].track_id, Some(11));
        assert_eq!(decoded.faces[0].keypoints[0], Keypoint { x: 0.2, y: 0.3 });
    }

    #[test]
    fn object_record_round_trip_preserves_source_and_pose_trackability() {
        let input = ObjectResult {
            index: 3,
            time: 0.6,
            detections: vec![SubjectDetection {
                box_: box_(0.15),
                label: "person".to_owned(),
                score: 0.91,
                track_id: Some(4),
                predicted: None,
                detector_source: Some("yolox"),
            }],
            poses: vec![PoseSubject {
                box_: box_(0.25),
                score: 0.8,
                track_id: Some(5),
                predicted: Some(false),
                head_box: Some(box_(0.3)),
                torso_box: None,
                trackable: true,
            }],
            motion_signal: Some((box_(0.4), 0.7)),
            device: NativeVisionDevice::DirectXHighPerformance,
            pose_device: NativeVisionDevice::Cpu,
            duration_ms: 12,
            pose_duration_ms: 6,
            recovery_passes: 8,
            recovery_pose_passes: 1,
        };
        let mut encoded = Vec::new();
        write_object_record(&mut encoded, input).unwrap();
        let decoded = decode_object_record(std::str::from_utf8(&encoded).unwrap()).unwrap();

        assert_eq!(decoded.detections[0].detector_source, Some("yolox"));
        assert!(decoded.poses[0].trackable);
        assert_eq!(decoded.motion_signal, Some((box_(0.4), 0.7)));
    }

    #[test]
    fn object_record_rejects_unknown_detector_source() {
        let input = ObjectResult {
            index: 0,
            time: 0.0,
            detections: vec![SubjectDetection {
                box_: box_(0.0),
                label: "person".to_owned(),
                score: 1.0,
                track_id: None,
                predicted: None,
                detector_source: Some("future-detector"),
            }],
            poses: Vec::new(),
            motion_signal: None,
            device: NativeVisionDevice::Cpu,
            pose_device: NativeVisionDevice::Cpu,
            duration_ms: 0,
            pose_duration_ms: 0,
            recovery_passes: 0,
            recovery_pose_passes: 0,
        };

        assert!(write_object_record(&mut Vec::new(), input).is_err());
    }
}
