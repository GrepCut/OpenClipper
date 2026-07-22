use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::video::ffmpeg::border::detect_border_features;
use super::super::shadow::GeneralizationShadowRunner;
use crate::video::ffmpeg::histogram::compute_autoflip_histogram_raw;
use super::super::decode::{copy_rgb, rotate_rgb, sample_due};
use super::super::internal::{
    AnalysisFrame, DETECTION_FPS, FACE_BUCKET_INTERVAL, FaceJob, FaceJobKind, HISTOGRAM_FPS,
};
use super::super::vision::NativeVisionError;
use super::decode_session::{DecodeFrameState, DecodeSessionMeta};
use super::setup::PipelineSetup;
use super::types::{NativeVisionProgress, RgbColor, StaticFeatureSample};

pub(crate) fn process_decoded_frame(
    state: &mut DecodeFrameState,
    meta: &DecodeSessionMeta,
    decoded: &ffmpeg_next::frame::Video,
    setup: &mut PipelineSetup,
    shadow_runner: &mut GeneralizationShadowRunner,
    cancelled: &Arc<AtomicBool>,
    progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<bool, NativeVisionError> {
    state.decoded_frame_count += 1;
    let Some(pts) = decoded.pts() else {
        return Ok(false);
    };
    let timestamp = pts as f64 * meta.time_base_sec;
    if timestamp >= meta.end_time {
        return Ok(true);
    }
    if timestamp < meta.start_time {
        return Ok(false);
    }
    let relative = timestamp - meta.start_time;
    state.frame_timestamps.push(relative);

    if sample_due(timestamp, &mut state.next_histogram, HISTOGRAM_FPS) {
        let started = Instant::now();
        state
            .histogram_scaler
            .run(decoded, &mut state.histogram_frame)
            .map_err(|error| {
                NativeVisionError::new(
                    "decode_failed",
                    format!("Histogram scale: {error}"),
                    true,
                )
            })?;
        let histogram = compute_autoflip_histogram_raw(
            state.histogram_frame.data(0),
            state.histogram_frame.stride(0),
            meta.histogram_width as usize,
            meta.histogram_height as usize,
        );
        if state.shot_detector.push(relative, histogram) {
            state.scene_cut_timestamps.push(relative);
        }
        state.histogram_sample_count += 1;
        state.t_histogram += started.elapsed().as_micros();
    }

    if !sample_due(timestamp, &mut state.next_detection, DETECTION_FPS) {
        return Ok(false);
    }
    let face_bucket = timestamp + 0.001 >= state.next_face_bucket;
    if face_bucket {
        while state.next_face_bucket <= timestamp + 0.001 {
            state.next_face_bucket += FACE_BUCKET_INTERVAL;
        }
    }
    let started = Instant::now();
    state
        .sample_scaler
        .run(decoded, &mut state.sample_frame)
        .map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Sample scale: {error}"), true)
        })?;
    state.t_sample_scale += started.elapsed().as_micros();
    let started = Instant::now();
    let raw = copy_rgb(
        &state.sample_frame,
        meta.sample_raw_width,
        meta.sample_raw_height,
    );
    let (rgb, width, height) = rotate_rgb(
        raw,
        meta.sample_raw_width,
        meta.sample_raw_height,
        meta.rotation,
    );
    state.t_copy_rotate += started.elapsed().as_micros();
    let transnet_scene_cut = shadow_runner.push_frame(
        &rgb,
        width as usize,
        height as usize,
        relative,
        state.pending_scene_cut,
        None,
        0,
    );
    if transnet_scene_cut {
        state.scene_cut_timestamps.push(relative);
        state.pending_scene_cut = true;
    }
    let border = if state.sample_count < 3
        || state.pending_scene_cut
        || transnet_scene_cut
        || state.last_border_features.is_none()
    {
        let started = Instant::now();
        let b = detect_border_features(
            &rgb,
            width as usize * 3,
            width as usize,
            height as usize,
        );
        state.t_border += started.elapsed().as_micros();
        state.last_border_features = Some(b);
        b
    } else {
        state.last_border_features.unwrap()
    };
    state
        .border_observations
        .push((border.top_border_px, border.bottom_border_px));
    if border.has_solid_background {
        state.solid_background_frames += 1;
        if let Some((r, g, b)) = border.solid_background_rgb {
            state.solid_rgb_sum.0 += r as u64;
            state.solid_rgb_sum.1 += g as u64;
            state.solid_rgb_sum.2 += b as u64;
        }
    }
    state.static_feature_samples.push(StaticFeatureSample {
        time: relative,
        has_solid_color_background: border.has_solid_background,
        solid_background_color: border.solid_background_rgb.map(|(r, g, b)| RgbColor {
            r,
            g,
            b,
        }),
    });
    let frame = Arc::new(AnalysisFrame {
        index: state.sample_count,
        time: relative,
        width,
        height,
        display_width: meta.display_width,
        display_height: meta.display_height,
        rgb,
        face_bucket,
        scene_cut: std::mem::take(&mut state.pending_scene_cut),
    });
    let started = Instant::now();
    let base_job = FaceJob {
        frame: frame.clone(),
        kind: FaceJobKind::Base,
    };
    let send_failed = setup.face_job_sender.send(base_job).is_err()
        || setup.object_sender.send(frame).is_err();
    state.t_send += started.elapsed().as_micros();
    if send_failed {
        cancelled.store(true, Ordering::Relaxed);
        return Ok(true);
    }
    state.sample_count += 1;
    state.peak_face_queue = state.peak_face_queue.max(setup.face_job_sender.len());
    state.peak_object_queue = state.peak_object_queue.max(setup.object_sender.len());
    let percent = ((relative / meta.total_duration) * 90.0).clamp(0.0, 90.0) as usize;
    if progress(NativeVisionProgress {
        phase: "decoding",
        percent,
        timestamp_sec: relative,
        eta_seconds: None,
        face_sample: None,
        subject_sample: None,
        queued_detections: state.sample_count,
    })
    .is_err()
    {
        cancelled.store(true, Ordering::Relaxed);
        return Ok(true);
    }
    Ok(false)
}
