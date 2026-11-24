//! Model input preprocessing for WinML workers.

use std::path::Path;
use std::time::Instant;

use super::internal::{AnalysisFrame, FrameRegion, MAX_BATCH};
use super::vision::{NativeVisionDevice, NativeVisionError, NativeVisionModel, VisionModel};
use super::vision_logic::{
    decode_yolox_fast, AutoFlipFaceDetection, Letterbox, SubjectDetection, FACE_TILE_SIZE,
    MOVENET_INPUT_SIZE, YOLOX_INPUT_SIZE,
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
    let mut rgb = Vec::new();
    copy_region_rgb_into(frame, region, &mut rgb);
    rgb
}

/// Copies `region` into `rgb` as contiguous rows, reusing its allocation.
fn copy_region_rgb_into(frame: &AnalysisFrame, region: FrameRegion, rgb: &mut Vec<u8>) {
    debug_assert!(region.x + region.width <= frame.width);
    debug_assert!(region.y + region.height <= frame.height);
    let row_bytes = region.width as usize * 3;
    rgb.clear();
    for row in 0..region.height as usize {
        let source_start =
            ((region.y as usize + row) * frame.width as usize + region.x as usize) * 3;
        rgb.extend_from_slice(&frame.rgb[source_start..source_start + row_bytes]);
    }
}

/// Contiguous RGB pixels read by the face preprocessing.
#[derive(Clone, Copy)]
pub(crate) struct RgbImage<'a> {
    pub rgb: &'a [u8],
    pub width: u32,
    pub height: u32,
}

impl<'a> RgbImage<'a> {
    /// The whole frame, without copying.
    pub(crate) fn of(frame: &'a AnalysisFrame) -> Self {
        Self {
            rgb: &frame.rgb,
            width: frame.width,
            height: frame.height,
        }
    }

    /// The frame, or its `region` copied once into `scratch` so every view
    /// of a recovery tile resizes from the same contiguous pixels.
    pub(crate) fn of_region(
        frame: &'a AnalysisFrame,
        region: Option<FrameRegion>,
        scratch: &'a mut Vec<u8>,
    ) -> Self {
        match region {
            None => Self::of(frame),
            Some(region) => {
                copy_region_rgb_into(frame, region, scratch);
                Self {
                    rgb: scratch,
                    width: region.width,
                    height: region.height,
                }
            }
        }
    }
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
    model: &mut Option<NativeVisionModel>,
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
        NativeVisionModel::create_into(
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

/// Writes one RGB row as raw 0..255 BGR into the leading pixels of three
/// NCHW plane rows (mirrored when `flip`) and zero-fills the rest of each row.
fn write_bgr_row(pixels: &[u8], flip: bool, planes: [&mut [f32]; 3]) {
    let width = pixels.len() / 3;
    let [blue, green, red] = planes.map(|row| {
        let (content, padding) = row.split_at_mut(width);
        padding.fill(0.0);
        content
    });
    let store = |(((blue, green), red), pixel): (((&mut f32, &mut f32), &mut f32), &[u8])| {
        *blue = pixel[2] as f32;
        *green = pixel[1] as f32;
        *red = pixel[0] as f32;
    };
    let destinations = blue.iter_mut().zip(green.iter_mut()).zip(red.iter_mut());
    if flip {
        destinations
            .zip(pixels.chunks_exact(3).rev())
            .for_each(store);
    } else {
        destinations.zip(pixels.chunks_exact(3)).for_each(store);
    }
}

/// YuNet single-view input: raw 0..255 BGR NCHW, top-left letterbox, zero
/// padding. `flip` mirrors the letterboxed content horizontally.
pub(crate) fn prepare_face_input_into(
    image: RgbImage,
    (box_width, box_height): (usize, usize),
    flip: bool,
    output: &mut [f32],
    resize_scratch: &mut [u8],
) -> Letterbox {
    let plane = box_width * box_height;
    debug_assert_eq!(output.len(), plane * 3);
    letterbox_rows(
        image,
        (box_width, box_height),
        resize_scratch,
        |pixels, stride, width, height| {
            let (blue, rest) = output.split_at_mut(plane);
            let (green, red) = rest.split_at_mut(plane);
            let rows = blue
                .chunks_exact_mut(box_width)
                .zip(green.chunks_exact_mut(box_width))
                .zip(red.chunks_exact_mut(box_width));
            for (y, ((blue, green), red)) in rows.enumerate() {
                if y < height {
                    let start = y * stride;
                    write_bgr_row(&pixels[start..start + width * 3], flip, [blue, green, red]);
                } else {
                    for channel in [blue, green, red] {
                        channel.fill(0.0);
                    }
                }
            }
        },
    )
}

/// Top-left letterboxed RGB uint8 NHWC canvas with zero padding, for graphs
/// that convert and rescale on the GPU.
pub(crate) fn prepare_face_canvas_u8(
    image: RgbImage,
    (box_width, box_height): (usize, usize),
    output: &mut [u8],
    resize_scratch: &mut [u8],
) -> Letterbox {
    debug_assert_eq!(output.len(), box_width * box_height * 3);
    letterbox_rows(
        image,
        (box_width, box_height),
        resize_scratch,
        |pixels, stride, width, height| {
            for (y, row) in output.chunks_exact_mut(box_width * 3).enumerate() {
                if y < height {
                    let start = y * stride;
                    row[..width * 3].copy_from_slice(&pixels[start..start + width * 3]);
                    row[width * 3..].fill(0);
                } else {
                    row.fill(0);
                }
            }
        },
    )
}

/// Scales `image` to fit `box` (top-left aligned) and passes its rows to
/// `write` as `(pixels, stride, width, height)`.
fn letterbox_rows(
    image: RgbImage,
    (box_width, box_height): (usize, usize),
    resize_scratch: &mut [u8],
    write: impl FnOnce(&[u8], usize, usize, usize),
) -> Letterbox {
    let (source_width, source_height) = (image.width, image.height);
    let scale =
        (box_width as f32 / source_width as f32).min(box_height as f32 / source_height as f32);
    let width = (source_width as f32 * scale)
        .round()
        .clamp(1.0, box_width as f32) as usize;
    let height = (source_height as f32 * scale)
        .round()
        .clamp(1.0, box_height as f32) as usize;
    let pixels: &[u8] = if source_width as usize == width && source_height as usize == height {
        image.rgb
    } else {
        let scratch = &mut resize_scratch[..width * height * 3];
        resize_rgb_u8_into(
            image.rgb,
            source_width,
            source_height,
            width as u32,
            height as u32,
            scratch,
        );
        &*scratch
    };
    write(pixels, width * 3, width, height);
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

/// Splits a sampled frame into overlapping square face-tile crops. A face
/// close to a seam remains fully visible in at least one neighbouring tile.
pub(crate) fn quality_face_tiles(frame: &AnalysisFrame) -> Vec<TileSpec> {
    quality_tiles(frame, FACE_TILE_SIZE as u32, TILE_OVERLAP)
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

    fn prepare_face_reference(frame: &AnalysisFrame, output: &mut [f32]) -> Letterbox {
        let size = FACE_TILE_SIZE as u32;
        let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
        let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
        let height = (frame.height as f32 * scale)
            .round()
            .clamp(1.0, size as f32) as u32;
        let resized = resize_rgb(frame, width, height);
        let plane = FACE_TILE_SIZE * FACE_TILE_SIZE;
        output.fill(0.0);
        for y in 0..height as usize {
            for x in 0..width as usize {
                let source = (y * width as usize + x) * 3;
                let destination = y * FACE_TILE_SIZE + x;
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

    #[test]
    fn flipped_face_view_mirrors_letterboxed_content() {
        let size = 384;
        let plane = size * size;
        let mut scratch = vec![0; plane * 3];
        let frame = patterned_frame(1280, 720, 7);
        let mut plain = vec![f32::NAN; plane * 3];
        let mut flipped = vec![f32::NAN; plane * 3];
        let letterbox = prepare_face_input_into(
            RgbImage::of(&frame),
            (size, size),
            false,
            &mut plain,
            &mut scratch,
        );
        let mirrored = prepare_face_input_into(
            RgbImage::of(&frame),
            (size, size),
            true,
            &mut flipped,
            &mut scratch,
        );
        assert_eq!(letterbox, mirrored);
        let width = (1280.0 * letterbox.scale).round() as usize;
        let height = (720.0 * letterbox.scale).round() as usize;
        for channel in 0..3 {
            for y in 0..size {
                for x in 0..size {
                    let index = channel * plane + y * size + x;
                    let expected = if x < width && y < height {
                        plain[channel * plane + y * size + width - 1 - x]
                    } else {
                        0.0
                    };
                    assert_eq!(flipped[index].to_bits(), expected.to_bits());
                }
            }
        }
    }

    #[test]
    fn face_scratch_preprocessing_matches_reference_for_all_frame_shapes() {
        let plane = FACE_TILE_SIZE * FACE_TILE_SIZE * 3;
        let mut scratch = vec![0xA5; plane];
        for (seed, width, height) in [(1, 640, 640), (2, 1280, 720), (3, 720, 1280), (4, 17, 11)] {
            let frame = patterned_frame(width, height, seed);
            let mut expected = vec![f32::NAN; plane];
            let mut actual = vec![f32::NAN; plane];

            let expected_letterbox = prepare_face_reference(&frame, &mut expected);
            let actual_letterbox = prepare_face_input_into(
                RgbImage::of(&frame),
                (FACE_TILE_SIZE, FACE_TILE_SIZE),
                false,
                &mut actual,
                &mut scratch,
            );

            assert_eq!(actual_letterbox, expected_letterbox);
            assert!(actual
                .iter()
                .zip(&expected)
                .all(|(actual, expected)| actual.to_bits() == expected.to_bits()));
        }
    }

    #[test]
    fn face_canvas_rows_match_the_planar_input() {
        let (width, height) = (1536, 864);
        let frame = patterned_frame(1920, 1080, 5);
        let mut canvas = vec![0x77; width * height * 3];
        let mut planes = vec![f32::NAN; width * height * 3];
        let mut scratch = vec![0; width * height * 3];
        let canvas_letterbox = prepare_face_canvas_u8(
            RgbImage::of(&frame),
            (width, height),
            &mut canvas,
            &mut scratch,
        );
        let planar_letterbox = prepare_face_input_into(
            RgbImage::of(&frame),
            (width, height),
            false,
            &mut planes,
            &mut scratch,
        );
        assert_eq!(canvas_letterbox, planar_letterbox);
        let plane = width * height;
        for (index, pixel) in canvas.chunks_exact(3).enumerate() {
            assert_eq!(planes[index], pixel[2] as f32);
            assert_eq!(planes[plane + index], pixel[1] as f32);
            assert_eq!(planes[plane * 2 + index], pixel[0] as f32);
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
        let expected_face_letterbox = prepare_face_input_into(
            RgbImage::of(&materialized),
            (FACE_TILE_SIZE, FACE_TILE_SIZE),
            false,
            &mut expected_face,
            &mut expected_scratch,
        );
        let mut region_rgb = Vec::new();
        let actual_face_letterbox = prepare_face_input_into(
            RgbImage::of_region(&frame, Some(tile.region), &mut region_rgb),
            (FACE_TILE_SIZE, FACE_TILE_SIZE),
            false,
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
