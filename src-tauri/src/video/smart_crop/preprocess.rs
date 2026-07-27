//! Model input preprocessing for WinML workers.

use std::path::Path;
use std::sync::Arc;

use super::internal::{AnalysisFrame, MAX_BATCH};
use super::vision::{NativeVisionDevice, NativeVisionError, VisionModel, WinMlModel};
use super::vision_logic::{
    decode_yolox, AutoFlipFaceDetection, Letterbox, SubjectDetection, BLAZE_INPUT_SIZE,
    MOVENET_INPUT_SIZE, SCRFD_INPUT_SIZE, YOLOX_INPUT_SIZE,
};
use crate::video::ffmpeg::resize::resize_rgb_u8;

fn resize_rgb(frame: &AnalysisFrame, width: u32, height: u32) -> Vec<u8> {
    resize_rgb_u8(&frame.rgb, frame.width, frame.height, width, height)
}

pub(crate) fn prepare_yolox_into(frame: &AnalysisFrame, output: &mut [f32]) -> Letterbox {
    let size = YOLOX_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let resized = resize_rgb(frame, width, height);
    let plane = YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
    debug_assert_eq!(output.len(), plane * 3);
    output.fill(114.0);
    for y in 0..height as usize {
        for x in 0..width as usize {
            let source = (y * width as usize + x) * 3;
            let destination = y * YOLOX_INPUT_SIZE + x;
            output[destination] = resized[source + 2] as f32;
            output[plane + destination] = resized[source + 1] as f32;
            output[plane * 2 + destination] = resized[source] as f32;
        }
    }
    Letterbox {
        scale,
        pad_x: 0.0,
        pad_y: 0.0,
        source_width: frame.width,
        source_height: frame.height,
    }
}

pub(crate) fn evaluate_yolox_batch(
    model: &mut Option<WinMlModel>,
    batch: &[Arc<AnalysisFrame>],
    input: &mut [f32],
    letterboxes: &mut Vec<Letterbox>,
    output: &mut Vec<Vec<f32>>,
    model_path: &Path,
    fp16_model_path: &Path,
    labels: &[String],
) -> Result<(Vec<Vec<SubjectDetection>>, NativeVisionDevice), NativeVisionError> {
    let (bound, input) = prepare_yolox_batch_into(batch, input, letterboxes)?;
    let shape = [
        bound as i64,
        3,
        YOLOX_INPUT_SIZE as i64,
        YOLOX_INPUT_SIZE as i64,
    ];
    let device = if let Some(current) = model.as_mut() {
        current
            .evaluate_into(&shape, input, output)
            .map(|()| current.device())
    } else {
        WinMlModel::create_into(
            VisionModel::YoloX,
            model_path,
            Some(fp16_model_path),
            "images",
            &["output"],
            &shape,
            input,
            output,
        )
        .map(|created| {
            let device = created.device();
            *model = Some(created);
            device
        })
    }?;
    if output.len() != 1 {
        return Err(NativeVisionError::new(
            "tensor_contract_mismatch",
            "YOLOX output count changed",
            true,
        ));
    }
    let stride = batch_stride(output[0].len(), bound, "YOLOX")?;
    let detections = letterboxes
        .iter()
        .copied()
        .enumerate()
        .map(|(index, letterbox)| {
            decode_yolox(
                &output[0][index * stride..(index + 1) * stride],
                labels,
                letterbox,
                0.1,
            )
            .map_err(|message| NativeVisionError::new("tensor_contract_mismatch", message, true))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((detections, device))
}

fn prepare_yolox_batch_into<'a>(
    batch: &[Arc<AnalysisFrame>],
    input: &'a mut [f32],
    letterboxes: &mut Vec<Letterbox>,
) -> Result<(usize, &'a [f32]), NativeVisionError> {
    if batch.is_empty() || batch.len() > MAX_BATCH {
        return Err(NativeVisionError::new(
            "tensor_contract_mismatch",
            format!("Invalid YOLOX batch size {}", batch.len()),
            true,
        ));
    }
    let bound = if batch.len() == 1 { 1 } else { MAX_BATCH };
    let frame_elements = 3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
    let required = bound * frame_elements;
    if input.len() < required {
        return Err(NativeVisionError::new(
            "tensor_contract_mismatch",
            format!(
                "YOLOX scratch buffer too small: {} floats for {required}",
                input.len()
            ),
            true,
        ));
    }
    let input = &mut input[..required];
    input.fill(114.0);
    letterboxes.clear();
    for (index, frame) in batch.iter().enumerate() {
        letterboxes.push(prepare_yolox_into(
            frame,
            &mut input[index * frame_elements..(index + 1) * frame_elements],
        ));
    }
    Ok((bound, input))
}

/// InsightFace SCRFD preprocessing: RGB NCHW, top-left letterbox, and
/// `(pixel - 127.5) / 128` normalization.
pub(crate) fn prepare_scrfd_into(frame: &AnalysisFrame, output: &mut [f32]) -> Letterbox {
    let size = SCRFD_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let resized = resize_rgb(frame, width, height);
    let plane = SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE;
    debug_assert_eq!(output.len(), plane * 3);
    output.fill(-127.5 / 128.0);
    for y in 0..height as usize {
        for x in 0..width as usize {
            let source = (y * width as usize + x) * 3;
            let destination = y * SCRFD_INPUT_SIZE + x;
            output[destination] = (resized[source] as f32 - 127.5) / 128.0;
            output[plane + destination] = (resized[source + 1] as f32 - 127.5) / 128.0;
            output[plane * 2 + destination] = (resized[source + 2] as f32 - 127.5) / 128.0;
        }
    }
    Letterbox {
        scale,
        pad_x: 0.0,
        pad_y: 0.0,
        source_width: frame.width,
        source_height: frame.height,
    }
}

pub(crate) fn prepare_blaze_into(frame: &AnalysisFrame, input: &mut [f32]) -> Letterbox {
    let size = BLAZE_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let pad_x = (size - width) / 2;
    let pad_y = (size - height) / 2;
    let resized = resize_rgb(frame, width, height);
    // Letterbox padding stays zero-valued (-1.0 after normalization), exactly
    // like the previous zeroed-canvas overlay.
    input.fill(-1.0);
    let row_len = width as usize * 3;
    for y in 0..height as usize {
        let source_row = &resized[y * row_len..(y + 1) * row_len];
        let destination = ((y + pad_y as usize) * size as usize + pad_x as usize) * 3;
        for (target, &value) in input[destination..destination + row_len]
            .iter_mut()
            .zip(source_row)
        {
            *target = value as f32 / 127.5 - 1.0;
        }
    }
    Letterbox {
        scale,
        pad_x: pad_x as f32,
        pad_y: pad_y as f32,
        source_width: frame.width,
        source_height: frame.height,
    }
}

pub(crate) fn prepare_movenet_into(frame: &AnalysisFrame, input: &mut [f32]) -> Letterbox {
    let size = MOVENET_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let pad_x = (size - width) / 2;
    let pad_y = (size - height) / 2;
    let resized = resize_rgb(frame, width, height);
    input.fill(0.0);
    let row_len = width as usize * 3;
    for y in 0..height as usize {
        let source_row = &resized[y * row_len..(y + 1) * row_len];
        let destination = ((y + pad_y as usize) * size as usize + pad_x as usize) * 3;
        for (target, &value) in input[destination..destination + row_len]
            .iter_mut()
            .zip(source_row)
        {
            *target = value as f32;
        }
    }
    Letterbox {
        scale,
        pad_x: pad_x as f32,
        pad_y: pad_y as f32,
        source_width: frame.width,
        source_height: frame.height,
    }
}

const TILE_OVERLAP: f32 = 0.20;

fn tile_positions(length: u32, tile: u32, overlap: f32) -> Vec<u32> {
    if length <= tile {
        return vec![0];
    }
    let preferred_stride = ((tile as f32 * (1.0 - overlap)).round() as u32).max(1);
    let span = length - tile;
    let intervals = span.div_ceil(preferred_stride).max(1);
    (0..=intervals)
        .map(|index| ((index as u64 * span as u64) / intervals as u64) as u32)
        .collect()
}

/// Splits a sampled frame into overlapping square crops. A subject close to a
/// seam remains fully visible in at least one neighbouring tile.
pub(crate) fn quality_tiles(
    frame: &AnalysisFrame,
    tile_edge: u32,
    overlap: f32,
) -> Vec<(AnalysisFrame, f32, f32, f32, f32)> {
    let tile_edge = tile_edge.min(frame.width).min(frame.height).max(1);
    let x_positions = tile_positions(frame.width, tile_edge, overlap);
    let y_positions = tile_positions(frame.height, tile_edge, overlap);
    if x_positions.len() == 1 && y_positions.len() == 1 {
        return Vec::new();
    }
    x_positions
        .into_iter()
        .flat_map(|x| y_positions.iter().copied().map(move |y| (x, y)))
        .map(|(x, y)| {
            let row_bytes = tile_edge as usize * 3;
            let mut rgb = vec![0u8; row_bytes * tile_edge as usize];
            for row in 0..tile_edge as usize {
                let source_start = ((y as usize + row) * frame.width as usize + x as usize) * 3;
                rgb[row * row_bytes..(row + 1) * row_bytes]
                    .copy_from_slice(&frame.rgb[source_start..source_start + row_bytes]);
            }
            (
                AnalysisFrame {
                    index: frame.index,
                    time: frame.time,
                    width: tile_edge,
                    height: tile_edge,
                    display_width: frame.display_width,
                    display_height: frame.display_height,
                    rgb,
                    face_bucket: frame.face_bucket,
                    scene_cut: frame.scene_cut,
                },
                x as f32 / frame.width as f32,
                y as f32 / frame.height as f32,
                tile_edge as f32 / frame.width as f32,
                tile_edge as f32 / frame.height as f32,
            )
        })
        .collect()
}

/// Splits a sampled frame into overlapping square SCRFD-sized crops. A face
/// close to a seam remains fully visible in at least one neighbouring tile.
pub(crate) fn quality_face_tiles(
    frame: &AnalysisFrame,
) -> Vec<(AnalysisFrame, f32, f32, f32, f32)> {
    quality_tiles(frame, SCRFD_INPUT_SIZE as u32, TILE_OVERLAP)
}

pub(crate) fn quality_object_tiles(
    frame: &AnalysisFrame,
) -> Vec<(AnalysisFrame, f32, f32, f32, f32)> {
    quality_tiles(frame, YOLOX_INPUT_SIZE as u32, TILE_OVERLAP)
}

pub(crate) fn map_detection_from_tile(
    mut detection: SubjectDetection,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
) -> SubjectDetection {
    detection.box_.x = x + detection.box_.x * width;
    detection.box_.y = y + detection.box_.y * height;
    detection.box_.width *= width;
    detection.box_.height *= height;
    detection
}

pub(crate) fn map_face_from_tile(
    mut face: AutoFlipFaceDetection,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
) -> AutoFlipFaceDetection {
    face.box_.x = x + face.box_.x * width;
    face.box_.y = y + face.box_.y * height;
    face.box_.width *= width;
    face.box_.height *= height;
    for point in &mut face.keypoints {
        point.x = x + point.x * width;
        point.y = y + point.y * height;
    }
    face
}

/// Drains up to MAX_BATCH queued jobs: one blocking receive, then whatever
/// else is already waiting. Under backpressure batches fill up; when the
/// queue is quiet latency stays one frame.
pub(crate) fn drain_batch<T>(jobs: &crossbeam_channel::Receiver<T>, first: T) -> Vec<T> {
    let mut batch = Vec::with_capacity(MAX_BATCH);
    batch.push(first);
    while batch.len() < MAX_BATCH {
        match jobs.try_recv() {
            Ok(job) => batch.push(job),
            Err(_) => break,
        }
    }
    batch
}

/// Per-element output stride of a batched evaluation, or a contract error.
pub(crate) fn batch_stride(
    len: usize,
    bound: usize,
    what: &str,
) -> Result<usize, NativeVisionError> {
    if bound == 0 || len % bound != 0 {
        return Err(NativeVisionError::new(
            "tensor_contract_mismatch",
            format!("{what} output is not divisible by the batch size"),
            true,
        ));
    }
    Ok(len / bound)
}

#[cfg(test)]
mod tile_tests {
    use super::*;

    fn tiny_frame(index: usize, rgb: [u8; 3]) -> Arc<AnalysisFrame> {
        Arc::new(AnalysisFrame {
            index,
            time: index as f64,
            width: 2,
            height: 1,
            display_width: 2,
            display_height: 1,
            rgb: [rgb, rgb].concat(),
            face_bucket: false,
            scene_cut: false,
        })
    }

    #[test]
    fn yolox_batch_reuses_and_resets_the_caller_scratch_buffer() {
        let frame_elements = 3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
        let mut input = vec![7.0; MAX_BATCH * frame_elements];
        let original_ptr = input.as_ptr();
        let mut letterboxes = Vec::with_capacity(MAX_BATCH);
        let two_frames = vec![tiny_frame(0, [1, 2, 3]), tiny_frame(1, [4, 5, 6])];

        let (bound, prepared) =
            prepare_yolox_batch_into(&two_frames, &mut input, &mut letterboxes).unwrap();
        assert_eq!(bound, MAX_BATCH);
        assert_eq!(letterboxes.len(), 2);
        assert_eq!(prepared[0], 3.0);
        assert_eq!(prepared[frame_elements], 6.0);
        assert_eq!(prepared[2 * frame_elements], 114.0);

        let padding_index = YOLOX_INPUT_SIZE * (YOLOX_INPUT_SIZE - 1);
        input[padding_index] = -1.0;
        let one_frame = vec![tiny_frame(2, [7, 8, 9])];
        let (bound, prepared) =
            prepare_yolox_batch_into(&one_frame, &mut input, &mut letterboxes).unwrap();
        assert_eq!(bound, 1);
        assert_eq!(letterboxes.len(), 1);
        assert_eq!(prepared[0], 9.0);
        assert_eq!(prepared[padding_index], 114.0);
        assert_eq!(input.as_ptr(), original_ptr);
    }

    #[test]
    fn full_hd_grid_is_overlapping_and_covers_every_edge() {
        let x = tile_positions(1920, 640, TILE_OVERLAP);
        let y = tile_positions(1080, 640, TILE_OVERLAP);
        assert_eq!(x, vec![0, 426, 853, 1280]);
        assert_eq!(y, vec![0, 440]);
        assert!(x.windows(2).all(|pair| pair[1] - pair[0] <= 512));
        assert!(y.windows(2).all(|pair| pair[1] - pair[0] <= 512));
    }

    #[test]
    fn map_detection_from_tile_maps_normalized_box() {
        let mapped = map_detection_from_tile(
            SubjectDetection {
                box_: super::super::vision_logic::NormalizedBox {
                    x: 0.1,
                    y: 0.2,
                    width: 0.3,
                    height: 0.4,
                },
                label: "person".into(),
                score: 0.9,
                track_id: None,
                predicted: None,
                detector_source: Some("yolox"),
            },
            0.5,
            0.0,
            0.25,
            0.5,
        );
        assert!((mapped.box_.x - 0.525).abs() < 1e-6);
        assert!((mapped.box_.y - 0.1).abs() < 1e-6);
        assert!((mapped.box_.width - 0.075).abs() < 1e-6);
    }

    #[test]
    fn frame_at_model_size_does_not_need_tiles() {
        let frame = AnalysisFrame {
            index: 0,
            time: 0.0,
            width: 640,
            height: 640,
            display_width: 640,
            display_height: 640,
            rgb: vec![0; 640 * 640 * 3],
            face_bucket: true,
            scene_cut: false,
        };
        assert!(quality_face_tiles(&frame).is_empty());
    }
}
