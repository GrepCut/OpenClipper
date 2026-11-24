use super::geometry::source_point;
use super::types::{AutoFlipFaceDetection, Letterbox, NormalizedBox};

const YUNET_STRIDES: [usize; 3] = [8, 16, 32];

/// Output order of the OpenCV Zoo YuNet graph: classification, objectness,
/// box and five-landmark heads, each for strides 8, 16 and 32.
pub(super) const YUNET_OUTPUT_NAMES: [&str; 12] = [
    "cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32",
    "kps_8", "kps_16", "kps_32",
];

/// Raw candidates of one single-frame YuNet pass at or above `score_threshold`,
/// before suppression. The score is `sqrt(cls * obj)`; boxes are centre
/// offsets plus log sizes in stride units, landmarks are offsets from the cell.
/// `mirror_width` unmirrors a pass over a horizontally flipped input box of
/// that width, in box space before letterbox mapping.
pub(super) fn decode_yunet_candidates(
    outputs: &[Vec<f32>],
    (input_width, input_height): (usize, usize),
    letterbox: Letterbox,
    score_threshold: f32,
    mirror_width: Option<f32>,
) -> Result<Vec<AutoFlipFaceDetection>, String> {
    let unmirror = |x: f32| mirror_width.map_or(x, |width| width - x);
    if outputs.len() != YUNET_OUTPUT_NAMES.len() {
        return Err("tensor_contract_mismatch: YuNet requires twelve outputs".into());
    }
    let mut candidates = Vec::new();
    for (level, stride) in YUNET_STRIDES.into_iter().enumerate() {
        let columns = input_width / stride;
        let cells = columns * (input_height / stride);
        let (classes, objects) = (&outputs[level], &outputs[level + 3]);
        let (boxes, landmarks) = (&outputs[level + 6], &outputs[level + 9]);
        if classes.len() != cells
            || objects.len() != cells
            || boxes.len() != cells * 4
            || landmarks.len() != cells * 10
        {
            return Err(format!(
                "tensor_contract_mismatch: invalid YuNet stride-{stride} output length"
            ));
        }
        let scale = stride as f32;
        for cell in 0..cells {
            let score = (classes[cell].clamp(0.0, 1.0) * objects[cell].clamp(0.0, 1.0)).sqrt();
            if !score.is_finite() || score < score_threshold {
                continue;
            }
            let grid_x = (cell % columns) as f32;
            let grid_y = (cell / columns) as f32;
            let bbox = &boxes[cell * 4..cell * 4 + 4];
            let center_x = (grid_x + bbox[0]) * scale;
            let center_y = (grid_y + bbox[1]) * scale;
            let half_width = bbox[2].min(10.0).exp() * scale * 0.5;
            let half_height = bbox[3].min(10.0).exp() * scale * 0.5;
            let (left, right) = (
                unmirror(center_x - half_width),
                unmirror(center_x + half_width),
            );
            let min = source_point(left.min(right), center_y - half_height, letterbox);
            let max = source_point(left.max(right), center_y + half_height, letterbox);
            if max.x <= min.x || max.y <= min.y {
                continue;
            }
            let keypoints = landmarks[cell * 10..cell * 10 + 10]
                .chunks_exact(2)
                .map(|point| {
                    source_point(
                        unmirror((grid_x + point[0]) * scale),
                        (grid_y + point[1]) * scale,
                        letterbox,
                    )
                })
                .collect();
            candidates.push(AutoFlipFaceDetection {
                box_: NormalizedBox {
                    x: min.x,
                    y: min.y,
                    width: max.x - min.x,
                    height: max.y - min.y,
                },
                keypoints,
                score,
                track_id: None,
                predicted: None,
            });
        }
    }
    Ok(candidates)
}
