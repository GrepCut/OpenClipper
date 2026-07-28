use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::super::decode::{copy_rgb, rotate_rgb, sample_due};
use super::super::diagnostics;
use super::super::internal::{
    AnalysisFrame, FaceJob, FaceJobKind, ObjectFramePermit, ObjectJob, ObjectJobKind,
    DETECTION_FPS, FACE_BUCKET_INTERVAL, OBJECT_FRAME_CAPACITY,
};
use super::super::shadow::GeneralizationShadowRunner;
use super::super::vision::NativeVisionError;
use super::decode_session::{DecodeFrameState, DecodeSessionMeta};
use super::setup::PipelineSetup;
use super::types::{NativeVisionProgress, RgbColor, StaticFeatureSample};
use crate::video::ffmpeg::border::detect_border_features;
use crate::video::ffmpeg::histogram::compute_autoflip_histogram_raw;

/// Near-duplicate cut stamps (histogram + TransNet) collapse into one entry.
const SCENE_CUT_DEDUPE_SEC: f64 = 0.15;
/// TransNet scores the window center; only latch `pending_scene_cut` when that
/// center is near the current detection sample.
const TRANSNET_PENDING_SLACK_SEC: f64 = 0.3;
/// Progress is for UI only. Sending it for every 200 ms sample creates
/// thousands of WebView messages on long clips.
const PROGRESS_SAMPLE_STRIDE: usize = 50;
fn record_scene_cut(state: &mut DecodeFrameState, time: f64, set_pending: bool) {
    let is_dup = state
        .scene_cut_timestamps
        .iter()
        .rev()
        .take(4)
        .any(|stamp| (time - stamp).abs() < SCENE_CUT_DEDUPE_SEC);
    if !is_dup {
        state.scene_cut_timestamps.push(time);
    }
    if set_pending {
        state.pending_scene_cut = true;
    }
}

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
    if state.decoded_frame_count == 1 || state.decoded_frame_count % 120 == 0 {
        diagnostics::append(
            "decode",
            &format!(
                "heartbeat decoded_frames={} samples={} face_queue={} object_queue={}",
                state.decoded_frame_count,
                state.sample_count,
                setup.face_job_sender.len(),
                setup.object_base_job_sender.len(),
            ),
        );
    }
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

    // Shot boundary on every decoded frame (AutoFlip cadence); ML stays sparse.
    {
        let started = Instant::now();
        state
            .histogram_scaler
            .run(decoded, &mut state.histogram_frame)
            .map_err(|error| {
                NativeVisionError::new("decode_failed", format!("Histogram scale: {error}"), true)
            })?;
        let histogram = compute_autoflip_histogram_raw(
            state.histogram_frame.data(0),
            state.histogram_frame.stride(0),
            meta.histogram_width as usize,
            meta.histogram_height as usize,
        );
        let hist_rgb = copy_rgb(
            &state.histogram_frame,
            meta.histogram_width,
            meta.histogram_height,
        );
        if state.shot_detector.push(relative, histogram, hist_rgb) {
            record_scene_cut(state, relative, true);
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
    let transnet_cut_time = shadow_runner.push_frame(
        &rgb,
        width as usize,
        height as usize,
        relative,
        state.pending_scene_cut,
        None,
        0,
    );
    if let Some(cut_time) = transnet_cut_time {
        let near_now = (relative - cut_time).abs() <= TRANSNET_PENDING_SLACK_SEC;
        record_scene_cut(state, cut_time, near_now);
    }
    let border = if state.sample_count < 3
        || state.pending_scene_cut
        || transnet_cut_time.is_some()
        || state.last_border_features.is_none()
    {
        let started = Instant::now();
        let b = detect_border_features(&rgb, width as usize * 3, width as usize, height as usize);
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
        solid_background_color: border
            .solid_background_rgb
            .map(|(r, g, b)| RgbColor { r, g, b }),
    });
    let permit_started = Instant::now();
    loop {
        match setup
            .object_frame_permit_receiver
            .recv_timeout(Duration::from_millis(100))
        {
            Ok(()) => break,
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                if cancelled.load(Ordering::Relaxed) {
                    return Ok(true);
                }
            }
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                return Err(NativeVisionError::new(
                    "evaluation_failed",
                    "Object-frame lifecycle permit channel disconnected",
                    true,
                ));
            }
        }
    }
    let permit_wait_ms = permit_started.elapsed().as_millis();
    let object_frames_in_flight =
        OBJECT_FRAME_CAPACITY.saturating_sub(setup.object_frame_permit_receiver.len());
    if permit_wait_ms >= 50 {
        diagnostics::append(
            "backpressure",
            &format!(
                "object frame permit waited_ms={permit_wait_ms} in_flight={object_frames_in_flight}/{OBJECT_FRAME_CAPACITY} base_queue={} control_queue={} resources={}",
                setup.object_base_job_sender.len(),
                setup.object_control_job_sender.len(),
                diagnostics::resource_snapshot(),
            ),
        );
    }
    let object_frame_permit = ObjectFramePermit::new(setup.object_frame_permit_sender.clone());
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
    diagnostics::append(
        "decode",
        &format!(
            "enqueue sample={} t={relative:.3}s size={}x{} face_bucket={} scene_cut={} face_queue_before={} object_base_queue_before={} object_control_queue={} object_frames_in_flight={}/{}",
            state.sample_count,
            width,
            height,
            face_bucket,
            frame.scene_cut,
            setup.face_job_sender.len(),
            setup.object_base_job_sender.len(),
            setup.object_control_job_sender.len(),
            object_frames_in_flight,
            OBJECT_FRAME_CAPACITY,
        ),
    );
    let base_job = FaceJob {
        frame: frame.clone(),
        region: None,
        kind: FaceJobKind::Base,
    };
    let object_job = ObjectJob {
        kind: ObjectJobKind::Base {
            frame,
            permit: object_frame_permit,
        },
    };
    let send_failed = setup.face_job_sender.send(base_job).is_err()
        || setup.object_base_job_sender.send(object_job).is_err();
    state.t_send += started.elapsed().as_micros();
    if send_failed {
        diagnostics::append("decode", "worker queue send failed; cancelling analysis");
        cancelled.store(true, Ordering::Relaxed);
        return Ok(true);
    }
    state.sample_count += 1;
    state.peak_face_queue = state.peak_face_queue.max(setup.face_job_sender.len());
    state.peak_object_queue = state
        .peak_object_queue
        .max(setup.object_base_job_sender.len());
    let percent = ((relative / meta.total_duration) * 90.0).clamp(0.0, 90.0) as usize;
    if state.sample_count == 1 || state.sample_count % PROGRESS_SAMPLE_STRIDE == 0 || percent >= 90
    {
        if progress(NativeVisionProgress {
            phase: "decoding",
            percent,
            timestamp_sec: relative,
            eta_seconds: None,
            face_sample: None,
            subject_sample: None,
            face_samples: None,
            subject_samples: None,
            queued_detections: state.sample_count,
        })
        .is_err()
        {
            cancelled.store(true, Ordering::Relaxed);
            return Ok(true);
        }
    }
    Ok(false)
}
