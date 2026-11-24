use super::types::{Keypoint, Letterbox, NormalizedBox};

/// Maps a point of a top-left letterboxed model input (input pixels) back to
/// normalized source coordinates.
pub(crate) fn source_point(x: f32, y: f32, letterbox: Letterbox) -> Keypoint {
    Keypoint {
        x: ((x - letterbox.pad_x) / letterbox.scale / letterbox.source_width as f32)
            .clamp(0.0, 1.0),
        y: ((y - letterbox.pad_y) / letterbox.scale / letterbox.source_height as f32)
            .clamp(0.0, 1.0),
    }
}

pub(crate) fn inverse_letterbox_point(
    x: f32,
    y: f32,
    letterbox: Letterbox,
    input_size: usize,
) -> Keypoint {
    let size = input_size as f32;
    source_point(x * size, y * size, letterbox)
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
