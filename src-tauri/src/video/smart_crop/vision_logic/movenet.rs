use super::geometry::{box_around_points, box_iou, inverse_letterbox_point};
use super::types::{
    Letterbox, NormalizedBox, PoseSubject, MOVENET_INPUT_SIZE, MOVENET_INSTANCE_SIZE,
    MOVENET_KEYPOINT_COUNT, MOVENET_POSE_COUNT,
};

pub fn decode_movenet(output: &[f32], letterbox: Letterbox) -> Result<Vec<PoseSubject>, String> {
    if output.len() != MOVENET_POSE_COUNT * MOVENET_INSTANCE_SIZE {
        return Err("tensor_contract_mismatch: invalid MoveNet output length".into());
    }
    let mut poses = Vec::new();
    for instance in output.chunks_exact(MOVENET_INSTANCE_SIZE) {
        let score = instance[55];
        // MultiPose's instance score drops sharply for small, motion-blurred,
        // or partially off-screen people. Keep those candidates when several
        // keypoints still agree; downstream temporal tracking and salience
        // selection provide the second stage of validation.
        if score < 0.15 {
            continue;
        }
        let strong_keypoint_count = (0..MOVENET_KEYPOINT_COUNT)
            .filter(|index| instance[index * 3 + 2] >= 0.3)
            .count();
        let trackable = score >= 0.25 && strong_keypoint_count >= 4;
        let keypoint_threshold = if trackable { 0.3 } else { 0.2 };
        let mut keypoints: Vec<Option<super::types::Keypoint>> =
            Vec::with_capacity(MOVENET_KEYPOINT_COUNT);
        for index in 0..MOVENET_KEYPOINT_COUNT {
            let base = index * 3;
            keypoints.push((instance[base + 2] >= keypoint_threshold).then(|| {
                inverse_letterbox_point(
                    instance[base + 1],
                    instance[base],
                    letterbox,
                    MOVENET_INPUT_SIZE,
                )
            }));
        }
        if keypoints.iter().filter(|point| point.is_some()).count() < 4 {
            continue;
        }
        let top_left =
            inverse_letterbox_point(instance[52], instance[51], letterbox, MOVENET_INPUT_SIZE);
        let bottom_right =
            inverse_letterbox_point(instance[54], instance[53], letterbox, MOVENET_INPUT_SIZE);
        let box_ = NormalizedBox {
            x: top_left.x,
            y: top_left.y,
            width: (bottom_right.x - top_left.x).max(0.0),
            height: (bottom_right.y - top_left.y).max(0.0),
        };
        if box_.width <= 0.0 || box_.height <= 0.0 {
            continue;
        }
        let head_points: Vec<super::types::Keypoint> =
            keypoints[..5].iter().flatten().copied().collect();
        let torso_points: Vec<super::types::Keypoint> = [5usize, 6, 11, 12]
            .into_iter()
            .filter_map(|index| keypoints[index])
            .collect();
        let head_box = box_around_points(
            &head_points,
            (box_.width * 0.08).max(0.008),
            (box_.height * 0.04).max(0.008),
        );
        let torso_box = box_around_points(
            &torso_points,
            (box_.width * 0.08).max(0.008),
            (box_.height * 0.04).max(0.008),
        )
        .or_else(|| {
            Some(NormalizedBox {
                x: box_.x + box_.width * 0.2,
                y: box_.y + box_.height * 0.2,
                width: box_.width * 0.6,
                height: box_.height * 0.45,
            })
        });
        poses.push(PoseSubject {
            box_,
            score,
            track_id: None,
            predicted: None,
            head_box,
            torso_box,
            trackable,
        });
    }
    Ok(poses)
}

pub fn map_pose_from_tile(
    mut pose: PoseSubject,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
) -> PoseSubject {
    let map_box = |box_: NormalizedBox| -> NormalizedBox {
        NormalizedBox {
            x: x + box_.x * width,
            y: y + box_.y * height,
            width: box_.width * width,
            height: box_.height * height,
        }
    };
    pose.box_ = map_box(pose.box_);
    pose.head_box = pose.head_box.map(map_box);
    pose.torso_box = pose.torso_box.map(map_box);
    pose
}

pub fn merge_pose_subjects(
    mut candidates: Vec<PoseSubject>,
    iou_threshold: f32,
) -> Vec<PoseSubject> {
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected = Vec::new();
    for candidate in candidates {
        if selected
            .iter()
            .any(|kept: &PoseSubject| box_iou(kept.box_, candidate.box_) >= iou_threshold)
        {
            continue;
        }
        selected.push(candidate);
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pose_at(x: f32, y: f32, width: f32, height: f32, score: f32) -> PoseSubject {
        PoseSubject {
            box_: NormalizedBox {
                x,
                y,
                width,
                height,
            },
            score,
            track_id: None,
            predicted: None,
            head_box: Some(NormalizedBox {
                x: x + width * 0.25,
                y,
                width: width * 0.5,
                height: height * 0.25,
            }),
            torso_box: Some(NormalizedBox {
                x: x + width * 0.2,
                y: y + height * 0.2,
                width: width * 0.6,
                height: height * 0.5,
            }),
            trackable: true,
        }
    }

    #[test]
    fn map_pose_from_tile_maps_nested_boxes() {
        let mapped = map_pose_from_tile(pose_at(0.1, 0.2, 0.2, 0.3, 0.8), 0.5, 0.0, 0.25, 0.5);
        assert!((mapped.box_.x - 0.525).abs() < 1e-6);
        assert!((mapped.box_.y - 0.1).abs() < 1e-6);
        assert!((mapped.head_box.unwrap().x - 0.5375).abs() < 1e-6);
    }

    #[test]
    fn merge_pose_subjects_deduplicates_overlapping_poses() {
        let merged = merge_pose_subjects(
            vec![
                pose_at(0.1, 0.1, 0.2, 0.2, 0.9),
                pose_at(0.11, 0.11, 0.2, 0.2, 0.8),
            ],
            0.45,
        );
        assert_eq!(merged.len(), 1);
        assert!((merged[0].score - 0.9).abs() < f32::EPSILON);
    }
}
