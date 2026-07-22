//! FFmpeg frame decode helpers for the WinML pipeline.

use ffmpeg_next as ffmpeg;

use super::vision_logic::Rotation;

pub(crate) fn canonical_rotation_degrees(value: f64) -> Option<Rotation> {
    if !value.is_finite() {
        return None;
    }
    let normalized = ((value.round() as i32 % 360) + 360) % 360;
    match normalized {
        0 => Some(Rotation::R0),
        90 => Some(Rotation::R90),
        180 => Some(Rotation::R180),
        270 => Some(Rotation::R270),
        _ => None,
    }
}

pub(crate) fn stream_rotation(stream: &ffmpeg::Stream<'_>) -> Rotation {
    for side_data in stream.side_data() {
        if side_data.kind() != ffmpeg::codec::packet::side_data::Type::DisplayMatrix {
            continue;
        }
        let data = side_data.data();
        if data.len() < 9 * std::mem::size_of::<i32>() {
            continue;
        }
        let mut matrix = [0i32; 9];
        for (index, value) in matrix.iter_mut().enumerate() {
            *value =
                unsafe { std::ptr::read_unaligned(data.as_ptr().add(index * 4).cast::<i32>()) };
        }
        let counter_clockwise = unsafe { ffmpeg::ffi::av_display_rotation_get(matrix.as_ptr()) };
        if let Some(rotation) = canonical_rotation_degrees(-counter_clockwise) {
            return rotation;
        }
    }
    stream
        .metadata()
        .get("rotate")
        .and_then(|value| value.parse::<f64>().ok())
        .and_then(canonical_rotation_degrees)
        .unwrap_or(Rotation::R0)
}

pub(crate) fn copy_rgb(frame: &ffmpeg::frame::Video, width: u32, height: u32) -> Vec<u8> {
    let row_bytes = width as usize * 3;
    let mut output = vec![0u8; row_bytes * height as usize];
    for y in 0..height as usize {
        let source = &frame.data(0)[y * frame.stride(0)..y * frame.stride(0) + row_bytes];
        output[y * row_bytes..(y + 1) * row_bytes].copy_from_slice(source);
    }
    output
}

pub(crate) fn rotate_rgb(data: Vec<u8>, width: u32, height: u32, rotation: Rotation) -> (Vec<u8>, u32, u32) {
    if rotation == Rotation::R0 {
        return (data, width, height);
    }
    let (out_width, out_height) = match rotation {
        Rotation::R90 | Rotation::R270 => (height, width),
        _ => (width, height),
    };
    let mut output = vec![0u8; out_width as usize * out_height as usize * 3];
    for y in 0..height {
        for x in 0..width {
            let (out_x, out_y) = match rotation {
                Rotation::R0 => (x, y),
                Rotation::R90 => (height - 1 - y, x),
                Rotation::R180 => (width - 1 - x, height - 1 - y),
                Rotation::R270 => (y, width - 1 - x),
            };
            let source = (y as usize * width as usize + x as usize) * 3;
            let destination = (out_y as usize * out_width as usize + out_x as usize) * 3;
            output[destination..destination + 3].copy_from_slice(&data[source..source + 3]);
        }
    }
    (output, out_width, out_height)
}

pub(crate) fn scaler_dimensions(
    source_width: u32,
    source_height: u32,
    rotation: Rotation,
    displayed_target_width: u32,
) -> (u32, u32) {
    let displayed_width = if matches!(rotation, Rotation::R90 | Rotation::R270) {
        source_height
    } else {
        source_width
    };
    let scale = (displayed_target_width as f64 / displayed_width.max(1) as f64).min(1.0);
    let width = (((source_width as f64 * scale).round() as u32).max(2)) & !1;
    let height = (((source_height as f64 * scale).round() as u32).max(2)) & !1;
    (width, height)
}

pub(crate) fn sample_due(timestamp: f64, next_sample: &mut f64, samples_per_second: f64) -> bool {
    if timestamp + 0.001 < *next_sample {
        return false;
    }
    let interval = 1.0 / samples_per_second.max(0.001);
    while *next_sample <= timestamp + 0.001 {
        *next_sample += interval;
    }
    true
}

