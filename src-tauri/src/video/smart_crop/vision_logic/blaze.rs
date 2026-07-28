use super::geometry::box_iou;
use super::types::{AutoFlipFaceDetection, Keypoint, NormalizedBox};

pub fn weighted_face_nms(
    mut candidates: Vec<AutoFlipFaceDetection>,
    iou_threshold: f32,
) -> Vec<AutoFlipFaceDetection> {
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected: Vec<AutoFlipFaceDetection> = Vec::new();
    while !candidates.is_empty() {
        let first = candidates.remove(0);
        let mut group = vec![first];
        let reference = group[0].box_;
        let mut index = 0;
        while index < candidates.len() {
            if box_iou(reference, candidates[index].box_) >= iou_threshold {
                group.push(candidates.remove(index));
            } else {
                index += 1;
            }
        }
        if group.len() == 1 {
            selected.push(group.remove(0));
            continue;
        }
        let total_score: f32 = group.iter().map(|item| item.score).sum();
        let weighted = |value: fn(&AutoFlipFaceDetection) -> f32| {
            group
                .iter()
                .map(|item| value(item) * item.score)
                .sum::<f32>()
                / total_score.max(f32::EPSILON)
        };
        // BlazeFace exposes six landmarks, while SCRFD exposes five. This NMS
        // helper is shared by both decoders, so merge only landmarks available
        // in every detection in the overlap group.
        let keypoint_count = group
            .iter()
            .map(|item| item.keypoints.len())
            .min()
            .unwrap_or(0);
        let mut keypoints = Vec::with_capacity(keypoint_count);
        for keypoint in 0..keypoint_count {
            keypoints.push(Keypoint {
                x: group
                    .iter()
                    .map(|item| item.keypoints[keypoint].x * item.score)
                    .sum::<f32>()
                    / total_score,
                y: group
                    .iter()
                    .map(|item| item.keypoints[keypoint].y * item.score)
                    .sum::<f32>()
                    / total_score,
            });
        }
        selected.push(AutoFlipFaceDetection {
            box_: NormalizedBox {
                x: weighted(|item| item.box_.x),
                y: weighted(|item| item.box_.y),
                width: weighted(|item| item.box_.width),
                height: weighted(|item| item.box_.height),
            },
            keypoints,
            track_id: None,
            predicted: None,
            score: group.iter().map(|item| item.score).sum::<f32>() / group.len() as f32,
        });
    }
    selected
}
