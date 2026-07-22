use super::geometry::{box_iou, inverse_letterbox_point, stable_sigmoid};
use super::types::{
    Anchor, AutoFlipFaceDetection, Keypoint, Letterbox, NormalizedBox, BLAZE_ANCHOR_COUNT,
    BLAZE_INPUT_SIZE,
};

pub fn generate_blaze_anchors() -> Vec<Anchor> {
    let side = BLAZE_INPUT_SIZE / 4;
    let mut anchors = Vec::with_capacity(BLAZE_ANCHOR_COUNT);
    for y in 0..side {
        for x in 0..side {
            anchors.push(Anchor {
                x_center: (x as f32 + 0.5) / side as f32,
                y_center: (y as f32 + 0.5) / side as f32,
                width: 1.0,
                height: 1.0,
            });
        }
    }
    anchors
}

pub fn decode_blaze(
    regressors: &[f32],
    logits: &[f32],
    letterbox: Letterbox,
    min_score: f32,
) -> Result<Vec<AutoFlipFaceDetection>, String> {
    if regressors.len() != BLAZE_ANCHOR_COUNT * 16 || logits.len() != BLAZE_ANCHOR_COUNT {
        return Err("tensor_contract_mismatch: invalid BlazeFace output length".into());
    }
    let anchors = generate_blaze_anchors();
    let mut candidates = Vec::new();
    for (index, anchor) in anchors.iter().enumerate() {
        let score = stable_sigmoid(logits[index].clamp(-100.0, 100.0));
        if score < min_score {
            continue;
        }
        let raw = &regressors[index * 16..index * 16 + 16];
        // MediaPipe full-range TensorsToDetections uses
        // reverse_output_order=true: y, x, h, w and y/x keypoint pairs.
        let center = Keypoint {
            x: raw[1] / 192.0 + anchor.x_center,
            y: raw[0] / 192.0 + anchor.y_center,
        };
        let width = raw[3] / 192.0;
        let height = raw[2] / 192.0;
        let top_left = inverse_letterbox_point(
            center.x - width / 2.0,
            center.y - height / 2.0,
            letterbox,
            BLAZE_INPUT_SIZE,
        );
        let bottom_right = inverse_letterbox_point(
            center.x + width / 2.0,
            center.y + height / 2.0,
            letterbox,
            BLAZE_INPUT_SIZE,
        );
        let mut keypoints = Vec::with_capacity(6);
        for keypoint in 0..6 {
            keypoints.push(inverse_letterbox_point(
                raw[5 + keypoint * 2] / 192.0 + anchor.x_center,
                raw[4 + keypoint * 2] / 192.0 + anchor.y_center,
                letterbox,
                BLAZE_INPUT_SIZE,
            ));
        }
        candidates.push(AutoFlipFaceDetection {
            box_: NormalizedBox {
                x: top_left.x,
                y: top_left.y,
                width: (bottom_right.x - top_left.x).max(0.0),
                height: (bottom_right.y - top_left.y).max(0.0),
            },
            keypoints,
            track_id: None,
            predicted: None,
            score,
        });
    }
    Ok(weighted_face_nms(candidates, 0.4))
}

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
        let mut keypoints = Vec::with_capacity(6);
        for keypoint in 0..6 {
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
