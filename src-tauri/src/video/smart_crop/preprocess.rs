//! Model input preprocessing for WinML workers.

use std::path::Path;
use std::time::Instant;

use super::internal::{AnalysisFrame, FaceJob, FrameRegion, MAX_BATCH};
use super::vision::{NativeVisionDevice, NativeVisionError, VisionModel, WinMlModel};
use super::vision_logic::{
    decode_yolox_fast, AutoFlipFaceDetection, Letterbox, SubjectDetection, MOVENET_INPUT_SIZE,
    SCRFD_INPUT_SIZE, YOLOX_INPUT_SIZE,
};
use crate::video::ffmpeg::resize::{resize_rgb_u8, resize_rgb_u8_into};
#[cfg(test)]
use std::sync::Arc;

fn resize_rgb(frame: &AnalysisFrame, width: u32, height: u32) -> Vec<u8> {
    resize_rgb_u8(&frame.rgb, frame.width, frame.height, width, height)
}

#[derive(Clone, Copy)]
pub(crate) struct ModelFrame<'a> {
    pub frame: &'a AnalysisFrame,
    pub region: Option<FrameRegion>,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct YoloXBatchTelemetry {
    pub preprocess_us: u64,
    pub decode_us: u64,
    pub fast_decode_skipped_rows: u64,
}

fn source_dimensions(frame: &AnalysisFrame, region: Option<FrameRegion>) -> (u32, u32) {
    region
        .map(|value| (value.width, value.height))
        .unwrap_or((frame.width, frame.height))
}

fn copy_region_rgb(frame: &AnalysisFrame, region: FrameRegion) -> Vec<u8> {
    debug_assert!(region.x + region.width <= frame.width);
    debug_assert!(region.y + region.height <= frame.height);
    let row_bytes = region.width as usize * 3;
    let mut rgb = vec![0u8; row_bytes * region.height as usize];
    for row in 0..region.height as usize {
        let source_start =
            ((region.y as usize + row) * frame.width as usize + region.x as usize) * 3;
        rgb[row * row_bytes..(row + 1) * row_bytes]
            .copy_from_slice(&frame.rgb[source_start..source_start + row_bytes]);
    }
    rgb
}

fn pack_yolox_rgb(
    rgb: &[u8],
    width: usize,
    height: usize,
    stride_pixels: usize,
    origin_x: usize,
    origin_y: usize,
    output: &mut [f32],
) {
    let plane = YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
    for y in 0..height {
        for x in 0..width {
            let source = ((origin_y + y) * stride_pixels + origin_x + x) * 3;
            let destination = y * YOLOX_INPUT_SIZE + x;
            output[destination] = rgb[source + 2] as f32;
            output[plane + destination] = rgb[source + 1] as f32;
            output[plane * 2 + destination] = rgb[source] as f32;
        }
    }
}

fn prepare_yolox_into(
    frame: &AnalysisFrame,
    region: Option<FrameRegion>,
    output: &mut [f32],
) -> Letterbox {
    let size = YOLOX_INPUT_SIZE as u32;
    let (source_width, source_height) = source_dimensions(frame, region);
    let scale = (size as f32 / source_width as f32).min(size as f32 / source_height as f32);
    let width = (source_width as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let height = (source_height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let plane = YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
    debug_assert_eq!(output.len(), plane * 3);
    output.fill(114.0);

    if region.is_none() {
        let resized = resize_rgb_u8(&frame.rgb, source_width, source_height, width, height);
        pack_yolox_rgb(
            &resized,
            width as usize,
            height as usize,
            width as usize,
            0,
            0,
            output,
        );
    } else if source_width == width && source_height == height {
        let region = region.expect("region checked above");
        pack_yolox_rgb(
            &frame.rgb,
            width as usize,
            height as usize,
            frame.width as usize,
            region.x as usize,
            region.y as usize,
            output,
        );
    } else {
        let source = copy_region_rgb(frame, region.expect("region checked above"));
        let resized = resize_rgb_u8(&source, source_width, source_height, width, height);
        pack_yolox_rgb(
            &resized,
            width as usize,
            height as usize,
            width as usize,
            0,
            0,
            output,
        );
    }
    Letterbox {
        scale,
        pad_x: 0.0,
        pad_y: 0.0,
        source_width,
        source_height,
    }
}

pub(crate) fn evaluate_yolox_batch(
    model: &mut Option<WinMlModel>,
    batch: &[ModelFrame<'_>],
    input: &mut [f32],
    letterboxes: &mut Vec<Letterbox>,
    output: &mut Vec<Vec<f32>>,
    model_path: &Path,
    fp16_model_path: &Path,
    labels: &[String],
) -> Result<
    (
        Vec<Vec<SubjectDetection>>,
        NativeVisionDevice,
        YoloXBatchTelemetry,
    ),
    NativeVisionError,
> {
    let preprocess_started = Instant::now();
    let (bound, input) = prepare_yolox_batch_into(batch, input, letterboxes)?;
    let preprocess_us = preprocess_started.elapsed().as_micros() as u64;
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
    let decode_started = Instant::now();
    let mut fast_decode_skipped_rows = 0u64;
    let detections = letterboxes
        .iter()
        .copied()
        .enumerate()
        .map(|(index, letterbox)| {
            let tensor = &output[0][index * stride..(index + 1) * stride];
            decode_yolox_fast(tensor, labels, letterbox, 0.1)
                .map(|(detections, diagnostics)| {
                    fast_decode_skipped_rows += diagnostics.objectness_skipped_rows as u64;
                    detections
                })
                .map_err(|message| {
                    NativeVisionError::new("tensor_contract_mismatch", message, true)
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let telemetry = YoloXBatchTelemetry {
        preprocess_us,
        decode_us: decode_started.elapsed().as_micros() as u64,
        fast_decode_skipped_rows,
    };
    Ok((detections, device, telemetry))
}

fn prepare_yolox_batch_into<'a>(
    batch: &[ModelFrame<'_>],
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
    for (index, item) in batch.iter().enumerate() {
        let letterbox = prepare_yolox_into(
            item.frame,
            item.region,
            &mut input[index * frame_elements..(index + 1) * frame_elements],
        );
        letterboxes.push(letterbox);
    }
    Ok((bound, input))
}

/// InsightFace SCRFD preprocessing: RGB NCHW, top-left letterbox, and
/// `(pixel - 127.5) / 128` normalization.
pub(crate) fn prepare_scrfd_into(
    frame: &AnalysisFrame,
    region: Option<FrameRegion>,
    output: &mut [f32],
    resize_scratch: &mut [u8],
) -> Letterbox {
    let size = SCRFD_INPUT_SIZE as u32;
    let (source_width, source_height) = source_dimensions(frame, region);
    let scale = (size as f32 / source_width as f32).min(size as f32 / source_height as f32);
    let width = (source_width as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let height = (source_height as f32 * scale)
        .round()
        .clamp(1.0, size as f32) as u32;
    let plane = SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE;
    debug_assert_eq!(output.len(), plane * 3);
    output.fill(-127.5 / 128.0);

    if source_width == width && source_height == height {
        let (origin_x, origin_y) = region
            .map(|value| (value.x as usize, value.y as usize))
            .unwrap_or((0, 0));
        for y in 0..height as usize {
            for x in 0..width as usize {
                let source = ((origin_y + y) * frame.width as usize + origin_x + x) * 3;
                let destination = y * SCRFD_INPUT_SIZE + x;
                output[destination] = (frame.rgb[source] as f32 - 127.5) / 128.0;
                output[plane + destination] = (frame.rgb[source + 1] as f32 - 127.5) / 128.0;
                output[plane * 2 + destination] = (frame.rgb[source + 2] as f32 - 127.5) / 128.0;
            }
        }
    } else {
        let source_region;
        let source = if let Some(region) = region {
            source_region = copy_region_rgb(frame, region);
            source_region.as_slice()
        } else {
            frame.rgb.as_slice()
        };
        let resized_len = width as usize * height as usize * 3;
        let scratch = &mut resize_scratch[..resized_len];
        resize_rgb_u8_into(source, source_width, source_height, width, height, scratch);
        for y in 0..height as usize {
            for x in 0..width as usize {
                let source = (y * width as usize + x) * 3;
                let destination = y * SCRFD_INPUT_SIZE + x;
                output[destination] = (scratch[source] as f32 - 127.5) / 128.0;
                output[plane + destination] = (scratch[source + 1] as f32 - 127.5) / 128.0;
                output[plane * 2 + destination] = (scratch[source + 2] as f32 - 127.5) / 128.0;
            }
        }
    }
    Letterbox {
        scale,
        pad_x: 0.0,
        pad_y: 0.0,
        source_width,
        source_height,
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TileSpec {
    pub region: FrameRegion,
    pub offset_x: f32,
    pub offset_y: f32,
    pub span_x: f32,
    pub span_y: f32,
}

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
pub(crate) fn quality_tiles(frame: &AnalysisFrame, tile_edge: u32, overlap: f32) -> Vec<TileSpec> {
    let tile_edge = tile_edge.min(frame.width).min(frame.height).max(1);
    let x_positions = tile_positions(frame.width, tile_edge, overlap);
    let y_positions = tile_positions(frame.height, tile_edge, overlap);
    if x_positions.len() == 1 && y_positions.len() == 1 {
        return Vec::new();
    }
    x_positions
        .into_iter()
        .flat_map(|x| y_positions.iter().copied().map(move |y| (x, y)))
        .map(|(x, y)| TileSpec {
            region: FrameRegion {
                x,
                y,
                width: tile_edge,
                height: tile_edge,
            },
            offset_x: x as f32 / frame.width as f32,
            offset_y: y as f32 / frame.height as f32,
            span_x: tile_edge as f32 / frame.width as f32,
            span_y: tile_edge as f32 / frame.height as f32,
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn materialize_tile(frame: &AnalysisFrame, spec: TileSpec) -> AnalysisFrame {
    AnalysisFrame {
        index: frame.index,
        time: frame.time,
        width: spec.region.width,
        height: spec.region.height,
        display_width: frame.display_width,
        display_height: frame.display_height,
        rgb: copy_region_rgb(frame, spec.region),
        face_bucket: frame.face_bucket,
        scene_cut: frame.scene_cut,
    }
}

/// Splits a sampled frame into overlapping square SCRFD-sized crops. A face
/// close to a seam remains fully visible in at least one neighbouring tile.
pub(crate) fn quality_face_tiles(frame: &AnalysisFrame) -> Vec<TileSpec> {
    quality_tiles(frame, SCRFD_INPUT_SIZE as u32, TILE_OVERLAP)
}

pub(crate) fn quality_object_tiles(frame: &AnalysisFrame) -> Vec<TileSpec> {
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

/// Drain SCRFD work that is already available without delaying a single
/// frame. The batch-8 session is not numerically equivalent to the
/// single-frame session, so production preserves this immediate behavior and
/// only batches naturally accumulated work under backpressure.
pub(crate) fn drain_face_batch(
    jobs: &crossbeam_channel::Receiver<FaceJob>,
    first: FaceJob,
) -> (Vec<FaceJob>, u64) {
    let mut batch = Vec::with_capacity(MAX_BATCH);
    batch.push(first);
    while batch.len() < MAX_BATCH {
        match jobs.try_recv() {
            Ok(job) => batch.push(job),
            Err(_) => break,
        }
    }
    (batch, 0)
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
    use super::super::internal::FaceJobKind;
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

    fn patterned_frame(width: u32, height: u32, seed: usize) -> AnalysisFrame {
        let rgb = (0..width as usize * height as usize * 3)
            .map(|index| ((index * 31 + seed * 17) % 251) as u8)
            .collect();
        AnalysisFrame {
            index: seed,
            time: seed as f64,
            width,
            height,
            display_width: width,
            display_height: height,
            rgb,
            face_bucket: false,
            scene_cut: false,
        }
    }

    fn prepare_scrfd_reference(frame: &AnalysisFrame, output: &mut [f32]) -> Letterbox {
        let size = SCRFD_INPUT_SIZE as u32;
        let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
        let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
        let height = (frame.height as f32 * scale)
            .round()
            .clamp(1.0, size as f32) as u32;
        let resized = resize_rgb(frame, width, height);
        let plane = SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE;
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

    fn base_job(index: usize) -> FaceJob {
        FaceJob {
            frame: tiny_frame(index, [0, 0, 0]),
            region: None,
            kind: FaceJobKind::Base,
        }
    }

    fn tile_job(index: usize) -> FaceJob {
        FaceJob {
            frame: tiny_frame(index, [0, 0, 0]),
            region: None,
            kind: FaceJobKind::Tile {
                base_index: index,
                offset_x: 0.0,
                offset_y: 0.0,
                span_x: 1.0,
                span_y: 1.0,
            },
        }
    }

    #[test]
    fn face_batch_collects_a_prebuffered_full_batch() {
        let (sender, receiver) = crossbeam_channel::bounded(MAX_BATCH);
        for index in 0..MAX_BATCH {
            sender.send(base_job(index)).unwrap();
        }
        let first = receiver.recv().unwrap();

        let (batch, _) = drain_face_batch(&receiver, first);

        assert_eq!(batch.len(), MAX_BATCH);
        assert!(batch
            .iter()
            .all(|job| matches!(&job.kind, FaceJobKind::Base)));
    }

    #[test]
    fn face_tile_batch_does_not_add_a_collection_delay() {
        let (_sender, receiver) = crossbeam_channel::bounded(1);
        let (batch, wait_ms) = drain_face_batch(&receiver, tile_job(0));

        assert_eq!(batch.len(), 1);
        assert_eq!(wait_ms, 0);
    }

    #[test]
    fn face_tile_already_queued_after_base_is_drained_in_fifo_order() {
        let (sender, receiver) = crossbeam_channel::bounded(2);
        sender.send(base_job(1)).unwrap();
        sender.send(tile_job(2)).unwrap();
        let first = receiver.recv().unwrap();

        let (batch, _) = drain_face_batch(&receiver, first);

        assert_eq!(batch.len(), 2);
        assert!(matches!(&batch[0].kind, FaceJobKind::Base));
        assert!(matches!(&batch[1].kind, FaceJobKind::Tile { .. }));
    }

    #[test]
    fn face_batch_returns_single_frame_when_queue_is_empty() {
        let (_sender, receiver) = crossbeam_channel::bounded(1);
        let (batch, _) = drain_face_batch(&receiver, base_job(0));

        assert_eq!(batch.len(), 1);
    }

    #[test]
    fn scrfd_scratch_preprocessing_matches_reference_for_all_frame_shapes() {
        let plane = SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE * 3;
        let mut scratch = vec![0xA5; plane];
        for (seed, width, height) in [(1, 640, 640), (2, 1280, 720), (3, 720, 1280), (4, 17, 11)] {
            let frame = patterned_frame(width, height, seed);
            let mut expected = vec![f32::NAN; plane];
            let mut actual = vec![f32::NAN; plane];

            let expected_letterbox = prepare_scrfd_reference(&frame, &mut expected);
            let actual_letterbox = prepare_scrfd_into(&frame, None, &mut actual, &mut scratch);

            assert_eq!(actual_letterbox, expected_letterbox);
            assert!(actual
                .iter()
                .zip(&expected)
                .all(|(actual, expected)| actual.to_bits() == expected.to_bits()));
        }
    }

    #[test]
    fn yolox_batch_reuses_and_resets_the_caller_scratch_buffer() {
        let frame_elements = 3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
        let mut input = vec![7.0; MAX_BATCH * frame_elements];
        let original_ptr = input.as_ptr();
        let mut letterboxes = Vec::with_capacity(MAX_BATCH);
        let two_frames = vec![tiny_frame(0, [1, 2, 3]), tiny_frame(1, [4, 5, 6])];
        let two_views = two_frames
            .iter()
            .map(|frame| ModelFrame {
                frame,
                region: None,
            })
            .collect::<Vec<_>>();

        let (bound, prepared) =
            prepare_yolox_batch_into(&two_views, &mut input, &mut letterboxes).unwrap();
        assert_eq!(bound, MAX_BATCH);
        assert_eq!(letterboxes.len(), 2);
        assert_eq!(prepared[0], 3.0);
        assert_eq!(prepared[frame_elements], 6.0);
        assert_eq!(prepared[2 * frame_elements], 114.0);

        let padding_index = YOLOX_INPUT_SIZE * (YOLOX_INPUT_SIZE - 1);
        input[padding_index] = -1.0;
        let one_frame = vec![tiny_frame(2, [7, 8, 9])];
        let one_view = [ModelFrame {
            frame: &one_frame[0],
            region: None,
        }];
        let (bound, prepared) =
            prepare_yolox_batch_into(&one_view, &mut input, &mut letterboxes).unwrap();
        assert_eq!(bound, 1);
        assert_eq!(letterboxes.len(), 1);
        assert_eq!(prepared[0], 9.0);
        assert_eq!(prepared[padding_index], 114.0);
        assert_eq!(input.as_ptr(), original_ptr);
    }

    #[test]
    fn zero_copy_tile_preprocessing_matches_materialized_tiles() {
        let frame = patterned_frame(1280, 720, 9);
        let tile = quality_object_tiles(&frame)[1];
        let materialized = materialize_tile(&frame, tile);
        let frame_elements = 3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
        let mut expected = vec![f32::NAN; frame_elements];
        let mut actual = vec![f32::NAN; frame_elements];

        let expected_letterbox = prepare_yolox_into(&materialized, None, &mut expected);
        let actual_letterbox = prepare_yolox_into(&frame, Some(tile.region), &mut actual);

        assert_eq!(actual_letterbox, expected_letterbox);
        assert!(actual
            .iter()
            .zip(&expected)
            .all(|(actual, expected)| actual.to_bits() == expected.to_bits()));

        let mut expected_face = vec![f32::NAN; frame_elements];
        let mut actual_face = vec![f32::NAN; frame_elements];
        let mut expected_scratch = vec![0xA5; frame_elements];
        let mut actual_scratch = vec![0x5A; frame_elements];
        let expected_face_letterbox = prepare_scrfd_into(
            &materialized,
            None,
            &mut expected_face,
            &mut expected_scratch,
        );
        let actual_face_letterbox = prepare_scrfd_into(
            &frame,
            Some(tile.region),
            &mut actual_face,
            &mut actual_scratch,
        );

        assert_eq!(actual_face_letterbox, expected_face_letterbox);
        assert!(actual_face
            .iter()
            .zip(&expected_face)
            .all(|(actual, expected)| actual.to_bits() == expected.to_bits()));
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
