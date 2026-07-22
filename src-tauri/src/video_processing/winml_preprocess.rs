//! Model input preprocessing for WinML workers.

use fast_image_resize::images::Image;
use fast_image_resize::{FilterType as FirFilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use super::vision_logic::{
    decode_yolox, AutoFlipFaceDetection, Letterbox, SubjectDetection, BLAZE_INPUT_SIZE,
    MOVENET_INPUT_SIZE, YOLOX_INPUT_SIZE,
};
use super::winml_internal::{AnalysisFrame, MAX_BATCH};
use super::winml_vision::{NativeVisionDevice, NativeVisionError, VisionModel, WinMlModel};

thread_local! {
    static RGB_RESIZER: std::cell::RefCell<Resizer> = std::cell::RefCell::new(Resizer::new());
}

/// SIMD resize of an RGB frame buffer. `fast_image_resize` requires `&mut`
/// source slices but only reads them during resize.
fn resize_rgb(frame: &AnalysisFrame, width: u32, height: u32) -> Vec<u8> {
    let src_len = frame.rgb.len();
    // SAFETY: resize only reads source pixels; the API requires a mutable borrow.
    let src_mut = unsafe {
        std::slice::from_raw_parts_mut(frame.rgb.as_ptr() as *mut u8, src_len)
    };
    let src_image = Image::from_slice_u8(frame.width, frame.height, src_mut, PixelType::U8x3)
        .expect("validated RGB frame");
    let mut dst_image = Image::new(width, height, PixelType::U8x3);
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FirFilterType::Bilinear));
    RGB_RESIZER.with(|resizer| {
        resizer
            .borrow_mut()
            .resize(&src_image, &mut dst_image, Some(&options))
            .expect("RGB resize");
    });
    dst_image.into_vec()
}

pub(crate) fn prepare_yolox_into(frame: &AnalysisFrame, output: &mut [f32]) -> Letterbox {
    let size = YOLOX_INPUT_SIZE as u32;
    let scale = (size as f32 / frame.width as f32).min(size as f32 / frame.height as f32);
    let width = (frame.width as f32 * scale).round().clamp(1.0, size as f32) as u32;
    let height = (frame.height as f32 * scale).round().clamp(1.0, size as f32) as u32;
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
    model_path: &Path,
    labels: &[String],
) -> Result<(Vec<Vec<SubjectDetection>>, NativeVisionDevice), NativeVisionError> {
    let count = batch.len();
    let bound = if count == 1 { 1 } else { MAX_BATCH };
    let frame_elements = 3 * YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE;
    let mut input = vec![114.0f32; bound * frame_elements];
    let letterboxes = batch.iter().enumerate().map(|(index, frame)| {
        prepare_yolox_into(frame, &mut input[index * frame_elements..(index + 1) * frame_elements])
    }).collect::<Vec<_>>();
    let shape = [bound as i64, 3, YOLOX_INPUT_SIZE as i64, YOLOX_INPUT_SIZE as i64];
    let evaluated = if let Some(current) = model.as_mut() {
        current.evaluate(&shape, &input).map(|output| (output, current.device()))
    } else {
        WinMlModel::create(
            VisionModel::YoloX,
            model_path,
            None,
            "images",
            &["output"],
            &shape,
            &input,
        ).map(|(created, output)| {
            let device = created.device();
            *model = Some(created);
            (output, device)
        })
    }?;
    if evaluated.0.len() != 1 {
        return Err(NativeVisionError::new("tensor_contract_mismatch", "YOLOX output count changed", true));
    }
    let stride = batch_stride(evaluated.0[0].len(), bound, "YOLOX")?;
    let detections = letterboxes.into_iter().enumerate().map(|(index, letterbox)| {
        decode_yolox(
            &evaluated.0[0][index * stride..(index + 1) * stride],
            labels,
            letterbox,
            0.1,
        ).map_err(|message| NativeVisionError::new("tensor_contract_mismatch", message, true))
    }).collect::<Result<Vec<_>, _>>()?;
    Ok((detections, evaluated.1))
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

pub(crate) fn recovery_tiles(frame: &AnalysisFrame) -> Vec<(AnalysisFrame, f32, f32, f32, f32)> {
    let tile_width = ((frame.width as f32 * 0.6).round() as u32).clamp(1, frame.width);
    let tile_height = ((frame.height as f32 * 0.6).round() as u32).clamp(1, frame.height);
    let positions = [
        (0, 0),
        (frame.width - tile_width, 0),
        (0, frame.height - tile_height),
        (frame.width - tile_width, frame.height - tile_height),
    ];
    positions
        .into_iter()
        .map(|(x, y)| {
            let row_bytes = tile_width as usize * 3;
            let mut rgb = vec![0u8; row_bytes * tile_height as usize];
            for row in 0..tile_height as usize {
                let source_start = ((y as usize + row) * frame.width as usize + x as usize) * 3;
                rgb[row * row_bytes..(row + 1) * row_bytes]
                    .copy_from_slice(&frame.rgb[source_start..source_start + row_bytes]);
            }
            (
                AnalysisFrame {
                    index: frame.index,
                    time: frame.time,
                    width: tile_width,
                    height: tile_height,
                    display_width: frame.display_width,
                    display_height: frame.display_height,
                    rgb,
                    face_bucket: frame.face_bucket,
                    scene_cut: frame.scene_cut,
                },
                x as f32 / frame.width as f32,
                y as f32 / frame.height as f32,
                tile_width as f32 / frame.width as f32,
                tile_height as f32 / frame.height as f32,
            )
        })
        .collect()
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
pub(crate) fn batch_stride(len: usize, bound: usize, what: &str) -> Result<usize, NativeVisionError> {
    if bound == 0 || len % bound != 0 {
        return Err(NativeVisionError::new(
            "tensor_contract_mismatch",
            format!("{what} output is not divisible by the batch size"),
            true,
        ));
    }
    Ok(len / bound)
}


