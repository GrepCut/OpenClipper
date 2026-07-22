use super::geometry::box_iou;
use super::types::{
    Letterbox, NormalizedBox, SubjectDetection, YOLOX_CLASS_COUNT, YOLOX_INPUT_SIZE,
    YOLOX_PREDICTION_COUNT,
};

pub fn decode_yolox(
    output: &[f32],
    labels: &[String],
    letterbox: Letterbox,
    score_threshold: f32,
) -> Result<Vec<SubjectDetection>, String> {
    let row_size = 5 + YOLOX_CLASS_COUNT;
    if output.len() != YOLOX_PREDICTION_COUNT * row_size || labels.len() < YOLOX_CLASS_COUNT {
        return Err("tensor_contract_mismatch: invalid YOLOX output or label count".into());
    }
    let mut candidates = Vec::new();
    let mut row_index = 0usize;
    for stride in [8usize, 16, 32] {
        let side = YOLOX_INPUT_SIZE / stride;
        for grid_y in 0..side {
            for grid_x in 0..side {
                let row = &output[row_index * row_size..(row_index + 1) * row_size];
                row_index += 1;
                let (class_index, class_score) = row[5..]
                    .iter()
                    .copied()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(&b.1))
                    .unwrap_or((0, 0.0));
                let score = row[4] * class_score;
                if score < score_threshold {
                    continue;
                }
                let center_x = (row[0] + grid_x as f32) * stride as f32;
                let center_y = (row[1] + grid_y as f32) * stride as f32;
                let width = row[2].clamp(-20.0, 20.0).exp() * stride as f32;
                let height = row[3].clamp(-20.0, 20.0).exp() * stride as f32;
                let inverse_x = |value: f32| {
                    ((value - letterbox.pad_x) / letterbox.scale / letterbox.source_width as f32)
                        .clamp(0.0, 1.0)
                };
                let inverse_y = |value: f32| {
                    ((value - letterbox.pad_y) / letterbox.scale / letterbox.source_height as f32)
                        .clamp(0.0, 1.0)
                };
                let left = inverse_x(center_x - width / 2.0);
                let top = inverse_y(center_y - height / 2.0);
                let right = inverse_x(center_x + width / 2.0);
                let bottom = inverse_y(center_y + height / 2.0);
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
                    label: labels[class_index].clone(),
                    score,
                    track_id: None,
                    predicted: None,
                    detector_source: Some("yolox"),
                });
            }
        }
    }
    debug_assert_eq!(row_index, YOLOX_PREDICTION_COUNT);
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected: Vec<SubjectDetection> = Vec::with_capacity(100);
    for candidate in candidates {
        if selected
            .iter()
            .any(|kept| kept.label == candidate.label && box_iou(kept.box_, candidate.box_) >= 0.45)
        {
            continue;
        }
        selected.push(candidate);
        if selected.len() == 100 {
            break;
        }
    }
    Ok(selected)
}
