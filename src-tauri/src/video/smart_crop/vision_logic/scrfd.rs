use super::blaze::weighted_face_nms;
use super::types::{
    AutoFlipFaceDetection, Keypoint, Letterbox, NormalizedBox, SCRFD_ANCHORS_PER_CELL,
    SCRFD_INPUT_SIZE,
};

const SCRFD_STRIDES: [usize; 3] = [8, 16, 32];
const SCRFD_OUTPUT_COUNT: usize = 9;

fn source_point(x: f32, y: f32, letterbox: Letterbox) -> Keypoint {
    Keypoint {
        x: ((x - letterbox.pad_x) / letterbox.scale / letterbox.source_width as f32)
            .clamp(0.0, 1.0),
        y: ((y - letterbox.pad_y) / letterbox.scale / letterbox.source_height as f32)
            .clamp(0.0, 1.0),
    }
}

fn output_row(cell: usize, batch_index: usize, batch_size: usize, anchor: usize) -> usize {
    // The supplied SCRFD graph transposes NCHW to HWNC before flattening,
    // producing rows grouped as [spatial cell, batch, anchor, values].
    (cell * batch_size + batch_index) * SCRFD_ANCHORS_PER_CELL + anchor
}

/// Decodes one batch element from the nine-output SCRFD-10G-KPS graph.
pub fn decode_scrfd(
    outputs: &[Vec<f32>],
    batch_index: usize,
    batch_size: usize,
    letterbox: Letterbox,
    score_threshold: f32,
) -> Result<Vec<AutoFlipFaceDetection>, String> {
    if outputs.len() != SCRFD_OUTPUT_COUNT || batch_size == 0 || batch_index >= batch_size {
        return Err("tensor_contract_mismatch: invalid SCRFD output or batch index".into());
    }

    let mut candidates = Vec::new();
    for (level, stride) in SCRFD_STRIDES.into_iter().enumerate() {
        let side = SCRFD_INPUT_SIZE / stride;
        let cells = side * side;
        let rows = cells * batch_size * SCRFD_ANCHORS_PER_CELL;
        let scores = &outputs[level];
        let boxes = &outputs[level + 3];
        let keypoints = &outputs[level + 6];
        if scores.len() != rows || boxes.len() != rows * 4 || keypoints.len() != rows * 10 {
            return Err(format!(
                "tensor_contract_mismatch: invalid SCRFD stride-{stride} output length"
            ));
        }

        for grid_y in 0..side {
            for grid_x in 0..side {
                let cell = grid_y * side + grid_x;
                let center_x = (grid_x * stride) as f32;
                let center_y = (grid_y * stride) as f32;
                for anchor in 0..SCRFD_ANCHORS_PER_CELL {
                    let row = output_row(cell, batch_index, batch_size, anchor);
                    let score = scores[row];
                    if score < score_threshold {
                        continue;
                    }
                    let bbox = &boxes[row * 4..row * 4 + 4];
                    let left_top = source_point(
                        center_x - bbox[0].max(0.0) * stride as f32,
                        center_y - bbox[1].max(0.0) * stride as f32,
                        letterbox,
                    );
                    let right_bottom = source_point(
                        center_x + bbox[2].max(0.0) * stride as f32,
                        center_y + bbox[3].max(0.0) * stride as f32,
                        letterbox,
                    );
                    if right_bottom.x <= left_top.x || right_bottom.y <= left_top.y {
                        continue;
                    }
                    let raw_points = &keypoints[row * 10..row * 10 + 10];
                    let points = (0..5)
                        .map(|index| {
                            source_point(
                                center_x + raw_points[index * 2] * stride as f32,
                                center_y + raw_points[index * 2 + 1] * stride as f32,
                                letterbox,
                            )
                        })
                        .collect();
                    candidates.push(AutoFlipFaceDetection {
                        box_: NormalizedBox {
                            x: left_top.x,
                            y: left_top.y,
                            width: right_bottom.x - left_top.x,
                            height: right_bottom.y - left_top.y,
                        },
                        keypoints: points,
                        track_id: None,
                        predicted: None,
                        score,
                    });
                }
            }
        }
    }
    Ok(weighted_face_nms(candidates, 0.4))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outputs(batch_size: usize) -> Vec<Vec<f32>> {
        let rows = SCRFD_STRIDES.map(|stride| {
            let side = SCRFD_INPUT_SIZE / stride;
            side * side * batch_size * SCRFD_ANCHORS_PER_CELL
        });
        [
            vec![0.0; rows[0]],
            vec![0.0; rows[1]],
            vec![0.0; rows[2]],
            vec![0.0; rows[0] * 4],
            vec![0.0; rows[1] * 4],
            vec![0.0; rows[2] * 4],
            vec![0.0; rows[0] * 10],
            vec![0.0; rows[1] * 10],
            vec![0.0; rows[2] * 10],
        ]
        .into_iter()
        .collect()
    }

    fn identity_letterbox() -> Letterbox {
        Letterbox {
            scale: 1.0,
            pad_x: 0.0,
            pad_y: 0.0,
            source_width: 640,
            source_height: 640,
        }
    }

    #[test]
    fn decodes_box_and_five_keypoints() {
        let mut values = outputs(1);
        let cell = 20 * 80 + 30;
        let row = output_row(cell, 0, 1, 0);
        values[0][row] = 0.9;
        values[3][row * 4..row * 4 + 4].copy_from_slice(&[1.0, 2.0, 3.0, 4.0]);
        values[6][row * 10..row * 10 + 10]
            .copy_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0, -1.0]);

        let faces = decode_scrfd(&values, 0, 1, identity_letterbox(), 0.5).unwrap();
        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].keypoints.len(), 5);
        assert!((faces[0].box_.x - 232.0 / 640.0).abs() < 1e-6);
        assert!((faces[0].box_.y - 144.0 / 640.0).abs() < 1e-6);
        assert!((faces[0].box_.width - 32.0 / 640.0).abs() < 1e-6);
        assert!((faces[0].box_.height - 48.0 / 640.0).abs() < 1e-6);
    }

    #[test]
    fn selects_rows_for_requested_batch_element() {
        let mut values = outputs(2);
        let cell = 10 * 80 + 10;
        let row = output_row(cell, 1, 2, 1);
        values[0][row] = 0.95;
        values[3][row * 4..row * 4 + 4].copy_from_slice(&[1.0, 1.0, 1.0, 1.0]);

        assert!(decode_scrfd(&values, 0, 2, identity_letterbox(), 0.5)
            .unwrap()
            .is_empty());
        assert_eq!(
            decode_scrfd(&values, 1, 2, identity_letterbox(), 0.5)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn merges_overlapping_faces_with_five_keypoints() {
        let mut values = outputs(1);
        let cell = 20 * 80 + 30;
        for anchor in 0..SCRFD_ANCHORS_PER_CELL {
            let row = output_row(cell, 0, 1, anchor);
            values[0][row] = 0.9 - anchor as f32 * 0.05;
            values[3][row * 4..row * 4 + 4].copy_from_slice(&[2.0, 2.0, 2.0, 2.0]);
            values[6][row * 10..row * 10 + 10]
                .copy_from_slice(&[-0.5, -0.5, 0.5, -0.5, 0.0, 0.0, -0.5, 0.5, 0.5, 0.5]);
        }

        let faces = decode_scrfd(&values, 0, 1, identity_letterbox(), 0.5).unwrap();
        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].keypoints.len(), 5);
    }
}
