use crate::video::ffmpeg::resize::resize_rgb_u8;
use crate::video::smart_crop::vision_logic::NormalizedBox;

pub(super) const TRANSNET_WINDOW: usize = 100;
pub(super) const TRANSNET_HEIGHT: usize = 27;
pub(super) const TRANSNET_WIDTH: usize = 48;
pub(super) const TRANSNET_CUT_THRESHOLD: f32 = 0.5;

pub(super) const VINET_CLIPS: usize = 32;
pub(super) const VINET_HEIGHT: usize = 224;
pub(super) const VINET_WIDTH: usize = 384;
pub(super) const VINET_PLANE: usize = 3 * VINET_HEIGHT * VINET_WIDTH;
pub(super) const REID_WIDTH: usize = 128;
pub(super) const REID_HEIGHT: usize = 256;

pub(super) fn resize_rgb_crop_to_reid(
    rgb: &[u8],
    width: usize,
    height: usize,
    box_: NormalizedBox,
    output: &mut [f32],
) {
    let left = (box_.x * width as f32).clamp(0.0, width as f32 - 1.0) as usize;
    let top = (box_.y * height as f32).clamp(0.0, height as f32 - 1.0) as usize;
    let right = ((box_.x + box_.width) * width as f32).clamp(0.0, width as f32) as usize;
    let bottom = ((box_.y + box_.height) * height as f32).clamp(0.0, height as f32) as usize;
    let crop_w = (right - left).max(1);
    let crop_h = (bottom - top).max(1);
    let row_bytes = crop_w * 3;
    let mut crop = vec![0u8; row_bytes * crop_h];
    for row in 0..crop_h {
        let source_start = ((top + row) * width + left) * 3;
        let dest_start = row * row_bytes;
        crop[dest_start..dest_start + row_bytes]
            .copy_from_slice(&rgb[source_start..source_start + row_bytes]);
    }
    let resized = resize_rgb_u8(
        &crop,
        crop_w as u32,
        crop_h as u32,
        REID_WIDTH as u32,
        REID_HEIGHT as u32,
    );
    write_rgb_nchw_f32(&resized, REID_WIDTH, REID_HEIGHT, output);
}

pub(super) fn resize_rgb_to_vinet_frame(rgb: &[u8], width: usize, height: usize, output: &mut [f32]) {
    debug_assert_eq!(output.len(), VINET_PLANE);
    let resized = resize_rgb_u8(
        rgb,
        width as u32,
        height as u32,
        VINET_WIDTH as u32,
        VINET_HEIGHT as u32,
    );
    write_rgb_nchw_f32(&resized, VINET_WIDTH, VINET_HEIGHT, output);
}

pub(super) fn write_rgb_nchw_f32(rgb: &[u8], width: usize, height: usize, output: &mut [f32]) {
    let plane = width * height;
    for y in 0..height {
        for x in 0..width {
            let src_index = (y * width + x) * 3;
            let dst_index = y * width + x;
            if src_index + 2 < rgb.len() && dst_index + plane * 2 < output.len() {
                output[dst_index] = rgb[src_index] as f32 / 255.0;
                output[plane + dst_index] = rgb[src_index + 1] as f32 / 255.0;
                output[plane * 2 + dst_index] = rgb[src_index + 2] as f32 / 255.0;
            }
        }
    }
}

pub(super) fn saliency_map_to_box(map: &[f32], width: usize, height: usize) -> (NormalizedBox, f32) {
    let cells = width * height;
    if map.len() < cells {
        return (
            NormalizedBox {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            },
            0.0,
        );
    }
    let plane = &map[..cells];
    let max_value = plane.iter().copied().fold(0.0f32, f32::max);
    if max_value <= 1e-6 {
        return (
            NormalizedBox {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            },
            0.0,
        );
    }
    let threshold = max_value * 0.5;
    let mut weighted_x = 0.0f32;
    let mut weighted_y = 0.0f32;
    let mut weight_sum = 0.0f32;
    let mut min_x = width;
    let mut max_x = 0usize;
    let mut min_y = height;
    let mut max_y = 0usize;
    for y in 0..height {
        for x in 0..width {
            let value = plane[y * width + x];
            if value < threshold {
                continue;
            }
            weighted_x += x as f32 * value;
            weighted_y += y as f32 * value;
            weight_sum += value;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
    }
    if weight_sum <= 1e-6 {
        let peak = plane
            .iter()
            .enumerate()
            .max_by(|left, right| left.1.total_cmp(right.1))
            .map(|(index, _)| index)
            .unwrap_or(0);
        let peak_x = (peak % width) as f32 / width as f32;
        let peak_y = (peak / width) as f32 / height as f32;
        return (
            NormalizedBox {
                x: (peak_x - 0.125).clamp(0.0, 0.75),
                y: (peak_y - 0.125).clamp(0.0, 0.75),
                width: 0.25,
                height: 0.25,
            },
            max_value.clamp(0.0, 1.0),
        );
    }
    let center_x = weighted_x / weight_sum / width as f32;
    let center_y = weighted_y / weight_sum / height as f32;
    let span_x = ((max_x + 1 - min_x) as f32 / width as f32).clamp(0.12, 0.9);
    let span_y = ((max_y + 1 - min_y) as f32 / height as f32).clamp(0.12, 0.9);
    (
        NormalizedBox {
            x: (center_x - span_x * 0.5).clamp(0.0, 1.0 - span_x),
            y: (center_y - span_y * 0.5).clamp(0.0, 1.0 - span_y),
            width: span_x,
            height: span_y,
        },
        (weight_sum / (cells as f32 * max_value)).clamp(0.0, 1.0),
    )
}

pub(super) fn resize_rgb_to_transnet(rgb: &[u8], width: usize, height: usize, output: &mut Vec<f32>) {
    let start = output.len();
    output.resize(start + TRANSNET_HEIGHT * TRANSNET_WIDTH * 3, 0.0);
    let slice = &mut output[start..];
    let resized = resize_rgb_u8(
        rgb,
        width as u32,
        height as u32,
        TRANSNET_WIDTH as u32,
        TRANSNET_HEIGHT as u32,
    );
    for (dst_index, chunk) in resized.chunks_exact(3).enumerate() {
        let base = dst_index * 3;
        slice[base] = chunk[0] as f32 / 255.0;
        slice[base + 1] = chunk[1] as f32 / 255.0;
        slice[base + 2] = chunk[2] as f32 / 255.0;
    }
}
