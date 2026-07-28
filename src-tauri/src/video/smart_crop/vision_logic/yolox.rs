use super::geometry::box_iou;
use super::types::{
    Letterbox, NormalizedBox, SubjectDetection, YOLOX_CLASS_COUNT, YOLOX_INPUT_SIZE,
    YOLOX_PREDICTION_COUNT,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct YoloXFastDecodeDiagnostics {
    pub objectness_skipped_rows: usize,
}

#[cfg(test)]
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
    Ok(merge_subject_detections(candidates, 0.45))
}

#[derive(Clone, Copy)]
struct CompactCandidate {
    box_: NormalizedBox,
    class_index: usize,
    score: f32,
}

/// Equivalent YOLOX decoder specialized for the bundled sigmoid-output model.
/// It rejects rows whose objectness alone cannot reach the score threshold and
/// keeps class ids compact until NMS has selected the final detections.
pub fn decode_yolox_fast(
    output: &[f32],
    labels: &[String],
    letterbox: Letterbox,
    score_threshold: f32,
) -> Result<(Vec<SubjectDetection>, YoloXFastDecodeDiagnostics), String> {
    let row_size = 5 + YOLOX_CLASS_COUNT;
    if output.len() != YOLOX_PREDICTION_COUNT * row_size || labels.len() < YOLOX_CLASS_COUNT {
        return Err("tensor_contract_mismatch: invalid YOLOX output or label count".into());
    }
    let mut candidates = Vec::new();
    let mut row_index = 0usize;
    let mut diagnostics = YoloXFastDecodeDiagnostics::default();
    for stride in [8usize, 16, 32] {
        let side = YOLOX_INPUT_SIZE / stride;
        for grid_y in 0..side {
            for grid_x in 0..side {
                let row = &output[row_index * row_size..(row_index + 1) * row_size];
                row_index += 1;
                // The bundled YOLOX graph emits sigmoid probabilities in
                // [0, 1]. Therefore no class score can make this row pass.
                if row[4] < score_threshold {
                    diagnostics.objectness_skipped_rows += 1;
                    continue;
                }
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
                candidates.push(CompactCandidate {
                    box_: NormalizedBox {
                        x: left,
                        y: top,
                        width: right - left,
                        height: bottom - top,
                    },
                    class_index,
                    score,
                });
            }
        }
    }
    debug_assert_eq!(row_index, YOLOX_PREDICTION_COUNT);
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected: Vec<CompactCandidate> = Vec::with_capacity(100);
    for candidate in candidates {
        if selected.iter().any(|kept| {
            kept.class_index == candidate.class_index && box_iou(kept.box_, candidate.box_) >= 0.45
        }) {
            continue;
        }
        selected.push(candidate);
        if selected.len() == 100 {
            break;
        }
    }
    let detections = selected
        .into_iter()
        .map(|candidate| SubjectDetection {
            box_: candidate.box_,
            label: labels[candidate.class_index].clone(),
            score: candidate.score,
            track_id: None,
            predicted: None,
            detector_source: Some("yolox"),
        })
        .collect();
    Ok((detections, diagnostics))
}

pub fn merge_subject_detections(
    mut candidates: Vec<SubjectDetection>,
    iou_threshold: f32,
) -> Vec<SubjectDetection> {
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected: Vec<SubjectDetection> = Vec::with_capacity(100);
    for candidate in candidates {
        if selected.iter().any(|kept| {
            kept.label == candidate.label && box_iou(kept.box_, candidate.box_) >= iou_threshold
        }) {
            continue;
        }
        selected.push(candidate);
        if selected.len() == 100 {
            break;
        }
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::video::smart_crop::vision_logic::NormalizedBox;

    fn person_detection(x: f32, y: f32, width: f32, height: f32, score: f32) -> SubjectDetection {
        SubjectDetection {
            box_: NormalizedBox {
                x,
                y,
                width,
                height,
            },
            label: "person".into(),
            score,
            track_id: None,
            predicted: None,
            detector_source: Some("yolox"),
        }
    }

    #[test]
    fn merge_subject_detections_deduplicates_overlapping_boxes() {
        let merged = merge_subject_detections(
            vec![
                person_detection(0.1, 0.1, 0.2, 0.2, 0.9),
                person_detection(0.11, 0.11, 0.2, 0.2, 0.8),
            ],
            0.45,
        );
        assert_eq!(merged.len(), 1);
        assert!((merged[0].score - 0.9).abs() < f32::EPSILON);
    }

    #[test]
    fn fast_decoder_matches_reference_and_skips_low_objectness_rows() {
        let row_size = 5 + YOLOX_CLASS_COUNT;
        let mut output = vec![0.0; YOLOX_PREDICTION_COUNT * row_size];
        for row_index in [0usize, 17, 6401] {
            let row = &mut output[row_index * row_size..(row_index + 1) * row_size];
            row[0] = 0.5;
            row[1] = 0.5;
            row[2] = 1.0;
            row[3] = 1.0;
            row[4] = 0.9;
            row[5] = 0.8;
        }
        let labels = (0..YOLOX_CLASS_COUNT)
            .map(|index| format!("class-{index}"))
            .collect::<Vec<_>>();
        let letterbox = Letterbox {
            scale: 1.0,
            pad_x: 0.0,
            pad_y: 0.0,
            source_width: YOLOX_INPUT_SIZE as u32,
            source_height: YOLOX_INPUT_SIZE as u32,
        };

        let expected = decode_yolox(&output, &labels, letterbox, 0.1).unwrap();
        let (actual, diagnostics) = decode_yolox_fast(&output, &labels, letterbox, 0.1).unwrap();

        assert_eq!(actual, expected);
        assert_eq!(
            diagnostics.objectness_skipped_rows,
            YOLOX_PREDICTION_COUNT - 3
        );
    }
}
