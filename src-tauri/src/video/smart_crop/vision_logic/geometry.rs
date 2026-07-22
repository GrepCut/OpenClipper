use super::types::{Keypoint, Letterbox, NormalizedBox};

pub(crate) fn inverse_letterbox_point(
    x: f32,
    y: f32,
    letterbox: Letterbox,
    input_size: usize,
) -> Keypoint {
    let size = input_size as f32;
    Keypoint {
        x: ((x * size - letterbox.pad_x) / letterbox.scale / letterbox.source_width as f32)
            .clamp(0.0, 1.0),
        y: ((y * size - letterbox.pad_y) / letterbox.scale / letterbox.source_height as f32)
            .clamp(0.0, 1.0),
    }
}

pub(crate) fn box_around_points(
    points: &[Keypoint],
    margin_x: f32,
    margin_y: f32,
) -> Option<NormalizedBox> {
    if points.is_empty() {
        return None;
    }
    let left = points.iter().map(|point| point.x).fold(1.0f32, f32::min);
    let top = points.iter().map(|point| point.y).fold(1.0f32, f32::min);
    let right = points.iter().map(|point| point.x).fold(0.0f32, f32::max);
    let bottom = points.iter().map(|point| point.y).fold(0.0f32, f32::max);
    let x = (left - margin_x).clamp(0.0, 1.0);
    let y = (top - margin_y).clamp(0.0, 1.0);
    let right = (right + margin_x).clamp(0.0, 1.0);
    let bottom = (bottom + margin_y).clamp(0.0, 1.0);
    (right > x && bottom > y).then_some(NormalizedBox {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
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
