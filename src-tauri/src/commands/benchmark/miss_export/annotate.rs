use image::{codecs::jpeg::JpegEncoder, ExtendedColorType};

use crate::storage::repository::test_repository::TestTargetDto;

use super::types::{
    BenchmarkFrameDetail, NormalizedViewport, CROP_VIEWPORT_BORDER_PX, CROP_VIEWPORT_OUTLINE_RGB,
    CROP_VIEWPORT_RGB,
};

fn set_pixel(rgb: &mut [u8], width: u32, height: u32, x: i32, y: i32, color: [u8; 3]) {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return;
    }
    let index = (y as u32 * width + x as u32) as usize * 3;
    if index + 2 >= rgb.len() {
        return;
    }
    rgb[index] = color[0];
    rgb[index + 1] = color[1];
    rgb[index + 2] = color[2];
}

fn draw_rect_border(
    rgb: &mut [u8],
    width: u32,
    height: u32,
    x0: f64,
    y0: f64,
    w: f64,
    h: f64,
    color: [u8; 3],
    thickness: i32,
) {
    if thickness <= 0 {
        return;
    }
    let left = (x0 * width as f64).round() as i32;
    let top = (y0 * height as f64).round() as i32;
    let right = ((x0 + w) * width as f64).round() as i32;
    let bottom = ((y0 + h) * height as f64).round() as i32;
    for t in 0..thickness {
        let inset_top = top + t;
        let inset_bottom = bottom - t;
        let inset_left = left + t;
        let inset_right = right - t;
        if inset_top > inset_bottom || inset_left > inset_right {
            break;
        }
        for x in inset_left..=inset_right {
            set_pixel(rgb, width, height, x, inset_top, color);
            set_pixel(rgb, width, height, x, inset_bottom, color);
        }
        for y in inset_top..=inset_bottom {
            set_pixel(rgb, width, height, inset_left, y, color);
            set_pixel(rgb, width, height, inset_right, y, color);
        }
    }
}

fn draw_crop_viewport_border(
    rgb: &mut [u8],
    width: u32,
    height: u32,
    viewport: &NormalizedViewport,
) {
    draw_rect_border(
        rgb,
        width,
        height,
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
        CROP_VIEWPORT_OUTLINE_RGB,
        CROP_VIEWPORT_BORDER_PX + 2,
    );
    draw_rect_border(
        rgb,
        width,
        height,
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
        CROP_VIEWPORT_RGB,
        CROP_VIEWPORT_BORDER_PX,
    );
}

fn slot_color(slot: i32) -> [u8; 3] {
    if slot == 1 { [244, 114, 182] } else { [34, 211, 238] }
}

pub(crate) fn annotate_frame(
    mut rgb: Vec<u8>,
    width: u32,
    height: u32,
    detail: &BenchmarkFrameDetail,
    ground_truth: &[TestTargetDto],
) -> Vec<u8> {
    for viewport in &detail.viewports {
        draw_crop_viewport_border(&mut rgb, width, height, viewport);
    }
    for target in ground_truth {
        draw_rect_border(
            &mut rgb,
            width,
            height,
            target.x,
            target.y,
            target.width,
            target.height,
            slot_color(target.slot),
            3,
        );
    }
    rgb
}

pub(crate) fn encode_rgb_jpeg(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 88)
        .encode(rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|error| format!("JPEG encode error: {error}"))?;
    Ok(jpeg)
}
