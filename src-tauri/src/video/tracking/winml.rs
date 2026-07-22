//! ByteTrack glue and tracked detection remapping.

use super::bytetrack::{TrackDetection, TrackOutput};
use crate::video::smart_crop::vision_logic::{self, AutoFlipFaceDetection, PoseSubject, SubjectDetection};
use crate::video::smart_crop::internal::{ContentRect, NativeFaceBox};

pub(crate) fn stable_content_rect(observations: &[(u32, u32)], frame_height: u32) -> ContentRect {
    if observations.is_empty() || frame_height == 0 {
        return ContentRect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        };
    }
    let stable = |top: bool| {
        let present = observations
            .iter()
            .filter(|value| if top { value.0 > 0 } else { value.1 > 0 })
            .count();
        if present * 10 < observations.len() * 9 {
            return 0;
        }
        let mut values: Vec<u32> = observations
            .iter()
            .map(|value| if top { value.0 } else { value.1 })
            .collect();
        values.sort_unstable();
        values[values.len() / 2]
    };
    let top = stable(true).min(frame_height.saturating_sub(1));
    let bottom = stable(false).min(frame_height.saturating_sub(top + 1));
    ContentRect {
        x: 0.0,
        y: top as f32 / frame_height as f32,
        width: 1.0,
        height: (frame_height - top - bottom) as f32 / frame_height as f32,
    }
}

pub(crate) fn padded_face_box(face: &AutoFlipFaceDetection, width: u32, height: u32) -> NativeFaceBox {
    let padding_x = face.box_.width * 0.08;
    let padding_y = face.box_.height * 0.08;
    let left = (face.box_.x - padding_x).clamp(0.0, 1.0);
    let top = (face.box_.y - padding_y).clamp(0.0, 1.0);
    let right = (face.box_.x + face.box_.width + padding_x).clamp(0.0, 1.0);
    let bottom = (face.box_.y + face.box_.height + padding_y).clamp(0.0, 1.0);
    NativeFaceBox {
        x: left * width as f32,
        y: top * height as f32,
        width: (right - left) * width as f32,
        height: (bottom - top) * height as f32,
    }
}

fn to_track_detections<T>(
    items: &[T],
    filter: impl Fn(&T) -> bool,
    map: impl Fn(usize, &T) -> TrackDetection,
) -> Vec<TrackDetection> {
    items
        .iter()
        .enumerate()
        .filter(|(_, item)| filter(item))
        .map(|(index, item)| map(index, item))
        .collect()
}

pub(crate) fn subject_track_inputs(detections: &[SubjectDetection]) -> Vec<TrackDetection> {
    to_track_detections(detections, |_| true, |source_index, detection| TrackDetection {
        box_: detection.box_,
        label: detection.label.clone(),
        score: detection.score,
        source_index,
        detector_source: detection.detector_source,
    })
}

pub(crate) fn face_track_inputs(faces: &[AutoFlipFaceDetection]) -> Vec<TrackDetection> {
    to_track_detections(faces, |_| true, |source_index, face| TrackDetection {
        box_: face.box_,
        label: "face".into(),
        score: face.score,
        source_index,
        detector_source: None,
    })
}

pub(crate) fn pose_track_inputs(poses: &[PoseSubject]) -> Vec<TrackDetection> {
    to_track_detections(poses, |pose| pose.trackable, |source_index, pose| TrackDetection {
        box_: pose.box_,
        label: "pose-person".into(),
        score: pose.score,
        source_index,
        detector_source: None,
    })
}

pub(crate) fn tracked_subjects(outputs: Vec<TrackOutput>) -> Vec<SubjectDetection> {
    outputs
        .into_iter()
        .map(|output| SubjectDetection {
            box_: output.box_,
            label: output.label,
            score: output.score,
            track_id: Some(output.track_id),
            predicted: output.predicted.then_some(true),
            detector_source: output.detector_source,
        })
        .collect()
}

fn remap_face_box(
    face: &AutoFlipFaceDetection,
    target: vision_logic::NormalizedBox,
) -> AutoFlipFaceDetection {
    let source = face.box_;
    let map_x = |value: f32| {
        if source.width <= 1e-6 {
            target.x
        } else {
            (target.x + (value - source.x) / source.width * target.width).clamp(0.0, 1.0)
        }
    };
    let map_y = |value: f32| {
        if source.height <= 1e-6 {
            target.y
        } else {
            (target.y + (value - source.y) / source.height * target.height).clamp(0.0, 1.0)
        }
    };
    AutoFlipFaceDetection {
        box_: target,
        keypoints: face
            .keypoints
            .iter()
            .map(|point| vision_logic::Keypoint {
                x: map_x(point.x),
                y: map_y(point.y),
            })
            .collect(),
        track_id: face.track_id,
        predicted: face.predicted,
        score: face.score,
    }
}

pub(crate) fn tracked_faces(
    outputs: Vec<TrackOutput>,
    faces: &[AutoFlipFaceDetection],
) -> Vec<AutoFlipFaceDetection> {
    outputs
        .into_iter()
        .map(|output| {
            let mut face = match output.source_index.and_then(|index| faces.get(index)) {
                Some(face) => remap_face_box(face, output.box_),
                None => AutoFlipFaceDetection {
                    box_: output.box_,
                    keypoints: Vec::new(),
                    track_id: None,
                    predicted: None,
                    score: output.score,
                },
            };
            face.track_id = Some(output.track_id);
            face.predicted = output.predicted.then_some(true);
            face
        })
        .collect()
}

fn remap_child_box(
    child: Option<vision_logic::NormalizedBox>,
    source: vision_logic::NormalizedBox,
    target: vision_logic::NormalizedBox,
) -> Option<vision_logic::NormalizedBox> {
    let child = child?;
    if source.width <= 1e-6 || source.height <= 1e-6 {
        return None;
    }
    Some(vision_logic::NormalizedBox {
        x: (target.x + (child.x - source.x) / source.width * target.width).clamp(0.0, 1.0),
        y: (target.y + (child.y - source.y) / source.height * target.height).clamp(0.0, 1.0),
        width: (child.width / source.width * target.width).clamp(0.0, 1.0),
        height: (child.height / source.height * target.height).clamp(0.0, 1.0),
    })
}

pub(crate) fn tracked_poses(outputs: Vec<TrackOutput>, poses: &[PoseSubject]) -> Vec<PoseSubject> {
    const POSE_TRACK_ID_OFFSET: u64 = 1_000_000;
    outputs
        .into_iter()
        .map(|output| {
            if let Some(source) = output.source_index.and_then(|index| poses.get(index)) {
                PoseSubject {
                    box_: output.box_,
                    score: output.score,
                    track_id: Some(POSE_TRACK_ID_OFFSET + output.track_id),
                    predicted: output.predicted.then_some(true),
                    head_box: remap_child_box(source.head_box, source.box_, output.box_),
                    torso_box: remap_child_box(source.torso_box, source.box_, output.box_),
                    trackable: true,
                }
            } else {
                PoseSubject {
                    box_: output.box_,
                    score: output.score,
                    track_id: Some(POSE_TRACK_ID_OFFSET + output.track_id),
                    predicted: Some(true),
                    head_box: None,
                    torso_box: Some(vision_logic::NormalizedBox {
                        x: output.box_.x + output.box_.width * 0.2,
                        y: output.box_.y + output.box_.height * 0.2,
                        width: output.box_.width * 0.6,
                        height: output.box_.height * 0.45,
                    }),
                    trackable: true,
                }
            }
        })
        .collect()
}

