//! Pure preprocessing/postprocessing and policy logic shared by the WinML
//! workers. Keep this module free of WinRT types so it is testable everywhere.

use serde::Serialize;
use std::collections::BTreeMap;

pub const SSD_INPUT_SIZE: usize = 320;
pub const SSD_ANCHOR_COUNT: usize = 2034;
pub const BLAZE_INPUT_SIZE: usize = 192;
pub const BLAZE_ANCHOR_COUNT: usize = 2304;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    pub x_center: f32,
    pub y_center: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectDetection {
    #[serde(rename = "box")]
    pub box_: NormalizedBox,
    pub label: String,
    pub score: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicted: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Keypoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFlipFaceDetection {
    #[serde(rename = "box")]
    pub box_: NormalizedBox,
    pub keypoints: Vec<Keypoint>,
    #[serde(skip)]
    pub score: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Letterbox {
    pub scale: f32,
    pub pad_x: f32,
    pub pad_y: f32,
    pub source_width: u32,
    pub source_height: u32,
}

pub fn stable_sigmoid(value: f32) -> f32 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exp = value.exp();
        exp / (1.0 + exp)
    }
}

pub fn box_iou(a: NormalizedBox, b: NormalizedBox) -> f32 {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let bottom = (a.y + a.height).min(b.y + b.height);
    let intersection = (right - left).max(0.0) * (bottom - top).max(0.0);
    let union = a.width * a.height + b.width * b.height - intersection;
    if union <= 0.0 {
        0.0
    } else {
        intersection / union
    }
}

pub fn generate_ssd_anchors() -> Vec<Anchor> {
    let strides = [16usize, 32, 64, 128, 256, 512];
    let aspect_ratios = [1.0f32, 2.0, 0.5, 3.0, 0.3333];
    let scale_for = |layer: usize| 0.2 + (0.95 - 0.2) * layer as f32 / (strides.len() - 1) as f32;
    let mut anchors = Vec::with_capacity(SSD_ANCHOR_COUNT);
    for (layer, stride) in strides.into_iter().enumerate() {
        let scale = scale_for(layer);
        let mut shapes: Vec<(f32, f32)> = if layer == 0 {
            vec![(0.1, 1.0), (scale, 2.0), (scale, 0.5)]
        } else {
            aspect_ratios.iter().map(|ratio| (scale, *ratio)).collect()
        };
        if layer > 0 {
            let next = if layer + 1 == strides.len() {
                1.0
            } else {
                scale_for(layer + 1)
            };
            shapes.push(((scale * next).sqrt(), 1.0));
        }
        let feature_size = SSD_INPUT_SIZE.div_ceil(stride);
        for y in 0..feature_size {
            for x in 0..feature_size {
                for (shape_scale, ratio) in &shapes {
                    let sqrt_ratio = ratio.sqrt();
                    anchors.push(Anchor {
                        x_center: (x as f32 + 0.5) / feature_size as f32,
                        y_center: (y as f32 + 0.5) / feature_size as f32,
                        width: shape_scale * sqrt_ratio,
                        height: shape_scale / sqrt_ratio,
                    });
                }
            }
        }
    }
    debug_assert_eq!(anchors.len(), SSD_ANCHOR_COUNT);
    anchors
}

pub fn decode_ssd(
    boxes: &[f32],
    scores: &[f32],
    labels: &[String],
    score_threshold: f32,
) -> Result<Vec<SubjectDetection>, String> {
    if boxes.len() != SSD_ANCHOR_COUNT * 4 || scores.len() != SSD_ANCHOR_COUNT * 91 {
        return Err("tensor_contract_mismatch: invalid SSD output length".into());
    }
    let anchors = generate_ssd_anchors();
    let mut candidates = Vec::new();
    for (index, anchor) in anchors.iter().enumerate() {
        let mut label_index = 0usize;
        let mut score = 0.0f32;
        for class_index in 1..91 {
            let value = stable_sigmoid(scores[index * 91 + class_index]);
            if value > score {
                score = value;
                label_index = class_index;
            }
        }
        if score < score_threshold {
            continue;
        }
        let offset = index * 4;
        let y_center = boxes[offset] / 10.0 * anchor.height + anchor.y_center;
        let x_center = boxes[offset + 1] / 10.0 * anchor.width + anchor.x_center;
        let height = (boxes[offset + 2] / 5.0).exp() * anchor.height;
        let width = (boxes[offset + 3] / 5.0).exp() * anchor.width;
        let left = (x_center - width / 2.0).clamp(0.0, 1.0);
        let top = (y_center - height / 2.0).clamp(0.0, 1.0);
        let right = (x_center + width / 2.0).clamp(0.0, 1.0);
        let bottom = (y_center + height / 2.0).clamp(0.0, 1.0);
        if right <= left || bottom <= top {
            continue;
        }
        candidates.push(SubjectDetection {
            box_: NormalizedBox {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            },
            label: labels
                .get(label_index)
                .cloned()
                .unwrap_or_else(|| format!("class-{label_index}")),
            score,
            track_id: None,
            predicted: None,
        });
    }
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    // ByteTrack needs low-confidence candidates too. Suppress only within the
    // same class, otherwise overlapping COCO categories can erase each other.
    let mut selected: Vec<SubjectDetection> = Vec::with_capacity(30);
    for candidate in candidates {
        if selected
            .iter()
            .any(|item| item.label == candidate.label && box_iou(item.box_, candidate.box_) >= 0.4)
        {
            continue;
        }
        selected.push(candidate);
        if selected.len() == 30 {
            break;
        }
    }
    Ok(selected)
}

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

fn inverse_letterbox_point(point: Keypoint, letterbox: Letterbox) -> Keypoint {
    let size = BLAZE_INPUT_SIZE as f32;
    Keypoint {
        x: ((point.x * size - letterbox.pad_x) / letterbox.scale / letterbox.source_width as f32)
            .clamp(0.0, 1.0),
        y: ((point.y * size - letterbox.pad_y) / letterbox.scale / letterbox.source_height as f32)
            .clamp(0.0, 1.0),
    }
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
            Keypoint {
                x: center.x - width / 2.0,
                y: center.y - height / 2.0,
            },
            letterbox,
        );
        let bottom_right = inverse_letterbox_point(
            Keypoint {
                x: center.x + width / 2.0,
                y: center.y + height / 2.0,
            },
            letterbox,
        );
        let mut keypoints = Vec::with_capacity(6);
        for keypoint in 0..6 {
            keypoints.push(inverse_letterbox_point(
                Keypoint {
                    x: raw[5 + keypoint * 2] / 192.0 + anchor.x_center,
                    y: raw[4 + keypoint * 2] / 192.0 + anchor.y_center,
                },
                letterbox,
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
            score: group.iter().map(|item| item.score).sum::<f32>() / group.len() as f32,
        });
    }
    selected
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Rotation {
    R0,
    R90,
    R180,
    R270,
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn rotate_point(point: Keypoint, rotation: Rotation) -> Keypoint {
    match rotation {
        Rotation::R0 => point,
        Rotation::R90 => Keypoint {
            x: 1.0 - point.y,
            y: point.x,
        },
        Rotation::R180 => Keypoint {
            x: 1.0 - point.x,
            y: 1.0 - point.y,
        },
        Rotation::R270 => Keypoint {
            x: point.y,
            y: 1.0 - point.x,
        },
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn rotate_box(box_: NormalizedBox, rotation: Rotation) -> NormalizedBox {
    let corners = [
        rotate_point(
            Keypoint {
                x: box_.x,
                y: box_.y,
            },
            rotation,
        ),
        rotate_point(
            Keypoint {
                x: box_.x + box_.width,
                y: box_.y + box_.height,
            },
            rotation,
        ),
    ];
    let left = corners[0].x.min(corners[1].x);
    let top = corners[0].y.min(corners[1].y);
    NormalizedBox {
        x: left,
        y: top,
        width: (corners[0].x - corners[1].x).abs(),
        height: (corners[0].y - corners[1].y).abs(),
    }
}

#[derive(Default, Debug)]
pub struct RecoveryPolicy {
    consecutive_track_misses: u8,
    consecutive_person_without_face: u8,
    last_recovery_time: Option<f64>,
    first_bucket_in_scene: bool,
}

impl RecoveryPolicy {
    pub fn new_scene(&mut self) {
        self.consecutive_track_misses = 0;
        self.consecutive_person_without_face = 0;
        self.last_recovery_time = None;
        self.first_bucket_in_scene = true;
    }

    pub fn observe(
        &mut self,
        time: f64,
        is_face_bucket: bool,
        has_face: bool,
        has_person: bool,
        had_track: bool,
    ) -> bool {
        if has_face {
            self.consecutive_track_misses = 0;
            self.consecutive_person_without_face = 0;
            if is_face_bucket {
                self.first_bucket_in_scene = false;
            }
            return false;
        }
        if had_track {
            self.consecutive_track_misses = self.consecutive_track_misses.saturating_add(1);
        }
        if has_person {
            self.consecutive_person_without_face =
                self.consecutive_person_without_face.saturating_add(1);
        }
        let trigger = (is_face_bucket && self.first_bucket_in_scene)
            || self.consecutive_track_misses >= 2
            || self.consecutive_person_without_face >= 2;
        if is_face_bucket {
            self.first_bucket_in_scene = false;
        }
        let cooldown_ready = self
            .last_recovery_time
            .map_or(true, |last| time - last >= 1.0);
        if trigger && cooldown_ready {
            self.last_recovery_time = Some(time);
            self.consecutive_track_misses = 0;
            self.consecutive_person_without_face = 0;
            true
        } else {
            false
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn order_joined<T>(items: impl IntoIterator<Item = (usize, T)>) -> Vec<T> {
    items
        .into_iter()
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssd_anchor_contract_matches_worker() {
        let anchors = generate_ssd_anchors();
        assert_eq!(anchors.len(), 2034);
        assert_eq!(anchors[0].x_center, 0.025);
        assert!((anchors[0].width - 0.1).abs() < 1e-6);
        assert!((anchors[1].width - 0.2 * 2f32.sqrt()).abs() < 1e-6);
    }

    #[test]
    fn sigmoid_is_stable() {
        assert_eq!(stable_sigmoid(1000.0), 1.0);
        assert_eq!(stable_sigmoid(-1000.0), 0.0);
        assert_eq!(stable_sigmoid(0.0), 0.5);
    }

    #[test]
    fn ssd_filters_classes_and_suppresses_overlap() {
        let anchors = generate_ssd_anchors();
        let mut boxes = vec![0.0f32; SSD_ANCHOR_COUNT * 4];
        let mut scores = vec![-100.0f32; SSD_ANCHOR_COUNT * 91];
        scores[1] = 10.0;
        scores[91 + 1] = 9.0;
        // Make anchor 1 decode to anchor 0's 0.1 square.
        boxes[4 + 2] = 5.0 * (0.1 / anchors[1].height).ln();
        boxes[4 + 3] = 5.0 * (0.1 / anchors[1].width).ln();
        let labels = (0..91)
            .map(|index| format!("label-{index}"))
            .collect::<Vec<_>>();
        let detections = decode_ssd(&boxes, &scores, &labels, 0.6).expect("SSD contract");
        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].label, "label-1");
    }

    #[test]
    fn blaze_decode_matches_known_tensor() {
        let target = 24 + 24 * 48;
        let mut regressors = vec![0.0f32; BLAZE_ANCHOR_COUNT * 16];
        let mut logits = vec![-100.0f32; BLAZE_ANCHOR_COUNT];
        regressors[target * 16 + 2] = 19.2;
        regressors[target * 16 + 3] = 19.2;
        logits[target] = 10.0;
        let faces = decode_blaze(
            &regressors,
            &logits,
            Letterbox {
                scale: 1.0,
                pad_x: 0.0,
                pad_y: 0.0,
                source_width: 192,
                source_height: 192,
            },
            0.55,
        )
        .expect("BlazeFace contract");
        assert_eq!(faces.len(), 1);
        assert!((faces[0].box_.width - 0.1).abs() < 1e-5);
        assert!((faces[0].box_.height - 0.1).abs() < 1e-5);
        assert_eq!(faces[0].keypoints.len(), 6);
    }

    #[test]
    fn rotations_round_trip_boxes() {
        let box_ = NormalizedBox {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
        };
        let rotated = rotate_box(box_, Rotation::R90);
        let restored = rotate_box(rotated, Rotation::R270);
        assert!((restored.x - box_.x).abs() < 1e-6);
        assert!((restored.y - box_.y).abs() < 1e-6);
        assert!((restored.width - box_.width).abs() < 1e-6);
        assert!((restored.height - box_.height).abs() < 1e-6);
        assert_eq!(
            rotate_point(Keypoint { x: 0.2, y: 0.3 }, Rotation::R180),
            Keypoint { x: 0.8, y: 0.7 }
        );
        assert_eq!(
            rotate_point(Keypoint { x: 0.2, y: 0.3 }, Rotation::R270),
            Keypoint { x: 0.3, y: 0.8 }
        );
    }

    #[test]
    fn inverse_letterbox_maps_source_corners() {
        let letterbox = Letterbox {
            scale: 0.1,
            pad_x: 0.0,
            pad_y: 42.0,
            source_width: 1920,
            source_height: 1080,
        };
        let point = inverse_letterbox_point(
            Keypoint {
                x: 1.0,
                y: 150.0 / 192.0,
            },
            letterbox,
        );
        assert!((point.x - 1.0).abs() < 1e-6);
        assert!((point.y - 1.0).abs() < 1e-6);
    }

    #[test]
    fn recovery_has_trigger_cooldown_and_scene_reset() {
        let mut policy = RecoveryPolicy::default();
        policy.new_scene();
        assert!(policy.observe(0.0, true, false, false, false));
        assert!(!policy.observe(0.2, false, false, true, true));
        assert!(!policy.observe(0.4, false, false, true, true));
        assert!(policy.observe(1.1, false, false, true, true));
        policy.new_scene();
        assert!(policy.observe(1.2, true, false, false, false));
    }

    #[test]
    fn ordered_joiner_handles_out_of_order_completion() {
        assert_eq!(
            order_joined([(2, "c"), (0, "a"), (1, "b")]),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn bounded_queue_cancellation_shuts_worker_down() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{mpsc, Arc};
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = cancelled.clone();
        let (sender, receiver) = mpsc::sync_channel(1);
        let worker = std::thread::spawn(move || {
            while receiver.recv().is_ok() {
                if worker_cancelled.load(Ordering::Relaxed) {
                    break;
                }
            }
        });
        sender.send(1).expect("bounded send");
        cancelled.store(true, Ordering::Relaxed);
        let _ = sender.send(2);
        drop(sender);
        worker.join().expect("worker shutdown");
    }
}
