use super::geometry::box_iou;
use super::types::{AutoFlipFaceDetection, Keypoint, NormalizedBox};

/// Per-view decoder floor. Low-confidence views still vote for agreement.
pub const MULTISCALE_VIEW_FLOOR: f32 = 0.05;
const SUPPRESSION_IOU: f32 = 0.4;
const MEMBER_IOU: f32 = 0.5;
const AGREEMENT: f32 = 0.35;

/// Fused YuNet score → reference-detector score knots. Each pair maps the
/// fused threshold to the SCRFD-10G threshold with the same WIDER FACE holdout
/// precision, so the downstream 0.5 / 0.6 / 0.7 tracker thresholds keep their
/// meaning. Fused scores below 0.745 map under the 0.5 face threshold.
const SCORE_KNOTS: [(f32, f32); 6] = [
    (0.0, 0.0),
    (0.745, 0.5),
    (0.815, 0.6),
    (0.855, 0.7),
    (0.91, 0.8),
    (1.0, 1.0),
];

/// Greedy suppression keeping the highest-scoring box of every group whose
/// IoU with it exceeds 0.4. Coordinates and scores are not averaged.
pub fn greedy_face_nms(mut candidates: Vec<AutoFlipFaceDetection>) -> Vec<AutoFlipFaceDetection> {
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut kept: Vec<AutoFlipFaceDetection> = Vec::new();
    for candidate in candidates {
        if kept
            .iter()
            .all(|leader| box_iou(leader.box_, candidate.box_) <= SUPPRESSION_IOU)
        {
            kept.push(candidate);
        }
    }
    kept
}

struct Cluster {
    leader: usize,
    members: Vec<Option<usize>>,
}

/// Fuses suppressed per-view detections. Each box joins the cluster whose
/// leader it overlaps most (IoU > 0.4) or starts a new one; a cluster takes at
/// most one member per view (IoU ≥ 0.5). Coordinates are the score²-weighted
/// member mean, landmarks are the leader's, and the score blends the leader
/// with the best other view.
pub fn merge_face_views(views: Vec<Vec<AutoFlipFaceDetection>>) -> Vec<AutoFlipFaceDetection> {
    let view_count = views.len();
    let mut rows: Vec<(usize, AutoFlipFaceDetection)> = views
        .into_iter()
        .enumerate()
        .flat_map(|(view, faces)| faces.into_iter().map(move |face| (view, face)))
        .collect();
    rows.sort_by(|a, b| b.1.score.total_cmp(&a.1.score));
    let mut clusters: Vec<Cluster> = Vec::new();
    for (index, (view, face)) in rows.iter().enumerate() {
        let nearest = clusters
            .iter()
            .enumerate()
            .map(|(position, cluster)| (position, box_iou(rows[cluster.leader].1.box_, face.box_)))
            .filter(|&(_, overlap)| overlap > SUPPRESSION_IOU)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        match nearest {
            None => {
                let mut members = vec![None; view_count];
                members[*view] = Some(index);
                clusters.push(Cluster {
                    leader: index,
                    members,
                });
            }
            Some((position, overlap)) => {
                let slot = &mut clusters[position].members[*view];
                if overlap >= MEMBER_IOU && slot.is_none() {
                    *slot = Some(index);
                }
            }
        }
    }
    clusters
        .into_iter()
        .map(|cluster| {
            let leader = &rows[cluster.leader].1;
            let members = cluster
                .members
                .iter()
                .flatten()
                .map(|&index| &rows[index].1);
            let total: f32 = members.clone().map(|face| face.score * face.score).sum();
            let weighted = |value: fn(&NormalizedBox) -> f32| {
                members
                    .clone()
                    .map(|face| value(&face.box_) * face.score * face.score)
                    .sum::<f32>()
                    / total
            };
            let left = weighted(|b| b.x);
            let top = weighted(|b| b.y);
            let right = weighted(|b| b.x + b.width);
            let bottom = weighted(|b| b.y + b.height);
            let other = cluster
                .members
                .iter()
                .flatten()
                .filter(|&&index| index != cluster.leader)
                .map(|&index| rows[index].1.score)
                .fold(0.0f32, f32::max);
            AutoFlipFaceDetection {
                box_: NormalizedBox {
                    x: left,
                    y: top,
                    width: right - left,
                    height: bottom - top,
                },
                // The leader's landmarks: downstream uses only their extent,
                // so mirrored-view landmark order does not matter.
                keypoints: leader.keypoints.clone(),
                track_id: None,
                predicted: None,
                score: (1.0 - AGREEMENT) * leader.score + AGREEMENT * other,
            }
        })
        .collect()
}

/// Maps a fused multiscale score onto the calibrated tracker score scale by
/// piecewise linear interpolation between the knots.
pub fn calibrate_fused_score(score: f32) -> f32 {
    let score = score.clamp(0.0, 1.0);
    SCORE_KNOTS
        .windows(2)
        .find(|pair| score <= pair[1].0)
        .map(|pair| {
            let ((low_in, low_out), (high_in, high_out)) = (pair[0], pair[1]);
            low_out + (score - low_in) / (high_in - low_in) * (high_out - low_out)
        })
        .unwrap_or(1.0)
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
        // Tile and base detections may carry different landmark counts; merge
        // only the landmarks every detection in the overlap group provides.
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

/// Mirrors a detection decoded from a horizontally flipped view back into
/// the unflipped source frame.
pub fn unflip_face(mut face: AutoFlipFaceDetection) -> AutoFlipFaceDetection {
    face.box_.x = 1.0 - face.box_.x - face.box_.width;
    for point in &mut face.keypoints {
        point.x = 1.0 - point.x;
    }
    face
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(x: f32, y: f32, size: f32, score: f32) -> AutoFlipFaceDetection {
        AutoFlipFaceDetection {
            box_: NormalizedBox {
                x,
                y,
                width: size,
                height: size,
            },
            keypoints: Vec::new(),
            track_id: None,
            predicted: None,
            score,
        }
    }

    #[test]
    fn greedy_nms_keeps_leader_coordinates() {
        let kept = greedy_face_nms(vec![face(0.11, 0.1, 0.2, 0.6), face(0.1, 0.1, 0.2, 0.9)]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].box_.x, 0.1);
        assert_eq!(kept[0].score, 0.9);
    }

    #[test]
    fn agreeing_views_vote_on_box_and_raise_score() {
        let merged = merge_face_views(vec![
            vec![face(0.1, 0.1, 0.2, 0.8)],
            vec![face(0.12, 0.1, 0.2, 0.6)],
            vec![],
        ]);
        assert_eq!(merged.len(), 1);
        let expected_x = (0.1 * 0.64 + 0.12 * 0.36) / (0.64 + 0.36);
        assert!((merged[0].box_.x - expected_x).abs() < 1e-6);
        assert!((merged[0].score - (0.65 * 0.8 + 0.35 * 0.6)).abs() < 1e-6);
    }

    #[test]
    fn single_view_detection_is_discounted() {
        let merged = merge_face_views(vec![vec![face(0.1, 0.1, 0.2, 0.8)], vec![]]);
        assert!((merged[0].score - 0.65 * 0.8).abs() < 1e-6);
    }

    #[test]
    fn one_vote_per_view() {
        let merged = merge_face_views(vec![
            vec![face(0.1, 0.1, 0.2, 0.9)],
            vec![face(0.1, 0.1, 0.2, 0.8), face(0.105, 0.1, 0.2, 0.7)],
        ]);
        assert_eq!(merged.len(), 1);
        assert!((merged[0].score - (0.65 * 0.9 + 0.35 * 0.8)).abs() < 1e-6);
    }

    #[test]
    fn separate_faces_stay_separate() {
        let merged = merge_face_views(vec![vec![
            face(0.1, 0.1, 0.1, 0.9),
            face(0.6, 0.1, 0.1, 0.8),
        ]]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn unflip_mirrors_horizontally() {
        let face = unflip_face(face(0.1, 0.2, 0.3, 0.9));
        assert!((face.box_.x - 0.6).abs() < 1e-6);
        assert_eq!(face.box_.y, 0.2);
    }

    #[test]
    fn calibration_is_monotonic_and_bounded() {
        let mut previous = calibrate_fused_score(0.0);
        assert_eq!(previous, 0.0);
        for step in 1..=100 {
            let value = calibrate_fused_score(step as f32 / 100.0);
            assert!(value >= previous);
            previous = value;
        }
        assert!((previous - 1.0).abs() < 1e-6);
        assert!((calibrate_fused_score(0.745) - 0.5).abs() < 1e-6);
        assert!((calibrate_fused_score(0.855) - 0.7).abs() < 1e-6);
    }
}
