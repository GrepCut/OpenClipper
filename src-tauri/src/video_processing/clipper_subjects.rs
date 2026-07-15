use ffmpeg_next as ffmpeg;
use image::{codecs::jpeg::JpegEncoder, ExtendedColorType};
use serde::Serialize;
use std::path::Path;

pub(crate) const DETECTION_FPS: f64 = 5.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectFrame {
    timestamp: f64,
    width: u32,
    height: u32,
    frame_url: String,
}

fn encode_jpeg(frame: &ffmpeg::frame::Video, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let row_len = width as usize * 3;
    let mut rgb = Vec::with_capacity(row_len * height as usize);
    for row in 0..height as usize {
        let start = row * frame.stride(0);
        rgb.extend_from_slice(&frame.data(0)[start..start + row_len]);
    }
    let mut jpeg = Vec::with_capacity(rgb.len() / 5);
    JpegEncoder::new_with_quality(&mut jpeg, 78)
        .encode(&rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encode error: {e}"))?;
    Ok(jpeg)
}

pub(crate) fn write_frame(
    dir: &Path,
    base_url: &str,
    index: usize,
    timestamp: f64,
    rgb: &ffmpeg::frame::Video,
    width: u32,
    height: u32,
) -> Result<(SubjectFrame, usize), String> {
    let jpeg = encode_jpeg(rgb, width, height)?;
    let size = jpeg.len();
    let name = format!("s{index:05}.jpg");
    std::fs::write(dir.join(&name), jpeg).map_err(|e| format!("Frame write error: {e}"))?;
    Ok((
        SubjectFrame {
            timestamp,
            width,
            height,
            frame_url: format!("{base_url}/{name}"),
        },
        size,
    ))
}
