use super::super::shadow::GeneralizationShadowDiagnostics;
use super::super::vision::NativeVisionError;
use super::super::vision_logic::Rotation;
use super::decode_session::{DecodeSession, DecodeStats};
use super::merge::MergeOutput;
use super::types::{NativeVisionMetrics, NativeVisionProgress, NativeVisionSummary, RgbColor};
use crate::video::tracking::winml::stable_content_rect;

pub(crate) fn build_summary(
    session: &DecodeSession,
    decode_stats: DecodeStats,
    drain_duration_ms: u64,
    face_preprocess_ms: u64,
    pose_preprocess_ms: u64,
    merged: MergeOutput,
    tracking_enabled: bool,
    shadow_diagnostics: Option<GeneralizationShadowDiagnostics>,
    analysis_duration_ms: u64,
    progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<NativeVisionSummary, NativeVisionError> {
    let state = &session.state;
    let meta = &session.meta;
    let sample_count = decode_stats.sample_count;
    let has_solid_color_background =
        sample_count > 0 && state.solid_background_frames as f64 / sample_count as f64 >= 0.6;
    let solid_background_color = has_solid_color_background.then(|| RgbColor {
        r: (state.solid_rgb_sum.0 / state.solid_background_frames.max(1) as u64) as u8,
        g: (state.solid_rgb_sum.1 / state.solid_background_frames.max(1) as u64) as u8,
        b: (state.solid_rgb_sum.2 / state.solid_background_frames.max(1) as u64) as u8,
    });
    progress(NativeVisionProgress {
        phase: "complete",
        percent: 100,
        timestamp_sec: meta.total_duration,
        eta_seconds: Some(0.0),
        face_sample: None,
        subject_sample: None,
        face_samples: None,
        subject_samples: None,
        queued_detections: 0,
    })?;
    Ok(NativeVisionSummary {
        engine: "winml",
        face_device: merged.face_device,
        object_device: merged.object_device,
        pose_device: merged.pose_device,
        frame_width: meta.display_width,
        frame_height: meta.display_height,
        face_sample_count: merged.face_samples.len(),
        subject_sample_count: merged.subject_samples.len(),
        scene_cut_timestamps: state.scene_cut_timestamps.clone(),
        frame_timestamps: state.frame_timestamps.clone(),
        source_frame_rate: if session.source_frame_rate.is_finite()
            && session.source_frame_rate > 0.0
        {
            session.source_frame_rate
        } else {
            30.0
        },
        has_solid_color_background,
        solid_background_color,
        static_feature_samples: state.static_feature_samples.clone(),
        content_rect: stable_content_rect(
            &state.border_observations,
            if matches!(meta.rotation, Rotation::R90 | Rotation::R270) {
                meta.sample_raw_width
            } else {
                meta.sample_raw_height
            },
        ),
        model_version: "clipper-vision-v5-yolox-s-scrfd10g-tiled",
        tracker_version: tracking_enabled.then_some("bytetrack-v2"),
        metrics: NativeVisionMetrics {
            decode_duration_ms: decode_stats.decode_duration_ms,
            inference_duration_ms: merged.inference_duration_ms,
            analysis_duration_ms,
            merge_duration_ms: merged.merge_duration_ms,
            result_chunk_count: merged.result_chunk_count,
            drain_duration_ms,
            face_inference_ms: merged.face_inference_ms,
            object_inference_ms: merged.object_inference_ms,
            pose_inference_ms: merged.pose_inference_ms,
            base_face_passes: sample_count,
            recovery_face_passes: merged.recovery_face_passes,
            recovery_object_passes: merged.recovery_object_passes,
            recovery_pose_passes: merged.recovery_pose_passes,
            orientation_probe_passes: 0,
            peak_face_queue_depth: decode_stats.peak_face_queue,
            peak_object_queue_depth: decode_stats.peak_object_queue,
            encoded_jpeg_bytes: 0,
            tracker_duration_ms: merged.tracker_duration_ms,
            tracked_subject_count: merged.tracked_subject_count,
            predicted_subject_count: merged.predicted_subject_count,
            codec_decode_api_ms: (decode_stats.t_codec_decode_api / 1_000) as u64,
            histogram_ms: (decode_stats.t_histogram / 1_000) as u64,
            sample_scale_ms: (decode_stats.t_sample_scale / 1_000) as u64,
            frame_copy_rotate_ms: (decode_stats.t_copy_rotate / 1_000) as u64,
            border_analysis_ms: (decode_stats.t_border / 1_000) as u64,
            queue_wait_ms: (decode_stats.t_send / 1_000) as u64,
            face_preprocess_ms,
            pose_preprocess_ms,
            decoded_frame_count: decode_stats.decoded_frame_count,
            histogram_sample_count: decode_stats.histogram_sample_count,
            decode_thread_count: session.decode_threads,
            fast_decode_enabled: session.fast_decode_enabled,
        },
        shadow_diagnostics,
    })
}
