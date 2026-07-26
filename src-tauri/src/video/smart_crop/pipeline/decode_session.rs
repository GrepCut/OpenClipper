use ffmpeg_next as ffmpeg;
use ffmpeg_next::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_next::{format::Pixel, media::Type};
use std::thread;
use std::time::Instant;

use super::super::decode::{scaler_dimensions_for_long_edge, stream_rotation};
use super::super::vision::NativeVisionError;
use super::super::vision_logic::Rotation;
use super::types::StaticFeatureSample;
use crate::video::ffmpeg::border::BorderFeatures;
use crate::video::ffmpeg::frames::{ensure_ffmpeg_init, AutoFlipShotBoundaryDetector};

pub(crate) struct DecodeStats {
    pub sample_count: usize,
    pub decode_duration_ms: u64,
    pub peak_face_queue: usize,
    pub peak_object_queue: usize,
    pub t_codec_decode_api: u128,
    pub t_histogram: u128,
    pub t_sample_scale: u128,
    pub t_copy_rotate: u128,
    pub t_border: u128,
    pub t_send: u128,
    pub decoded_frame_count: usize,
    pub histogram_sample_count: usize,
}

pub(crate) struct DecodeSessionMeta {
    pub time_base_sec: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub total_duration: f64,
    pub display_width: u32,
    pub display_height: u32,
    pub sample_raw_width: u32,
    pub sample_raw_height: u32,
    pub histogram_width: u32,
    pub histogram_height: u32,
    pub rotation: Rotation,
}

pub(crate) struct DecodeFrameState {
    pub sample_scaler: Scaler,
    pub histogram_scaler: Scaler,
    pub histogram_frame: ffmpeg::frame::Video,
    pub sample_frame: ffmpeg::frame::Video,
    pub next_detection: f64,
    pub next_face_bucket: f64,
    pub shot_detector: AutoFlipShotBoundaryDetector,
    pub pending_scene_cut: bool,
    pub scene_cut_timestamps: Vec<f64>,
    pub frame_timestamps: Vec<f64>,
    pub static_feature_samples: Vec<StaticFeatureSample>,
    pub border_observations: Vec<(u32, u32)>,
    pub solid_background_frames: usize,
    pub solid_rgb_sum: (u64, u64, u64),
    pub sample_count: usize,
    pub last_border_features: Option<BorderFeatures>,
    pub seen_keyframe: bool,
    pub peak_face_queue: usize,
    pub peak_object_queue: usize,
    pub t_codec_decode_api: u128,
    pub t_histogram: u128,
    pub t_sample_scale: u128,
    pub t_copy_rotate: u128,
    pub t_border: u128,
    pub t_send: u128,
    pub decoded_frame_count: usize,
    pub histogram_sample_count: usize,
}

pub(crate) struct DecodeSession {
    pub input: ffmpeg::format::context::Input,
    pub decoder: ffmpeg::decoder::Video,
    pub stream_index: usize,
    pub meta: DecodeSessionMeta,
    pub state: DecodeFrameState,
    pub source_frame_rate: f64,
    pub decode_threads: usize,
    pub fast_decode_enabled: bool,
    pub decode_started: Instant,
}

impl DecodeSession {
    pub(crate) fn open(
        file_path: &str,
        start_time: f64,
        end_time: f64,
    ) -> Result<Self, NativeVisionError> {
        ensure_ffmpeg_init().map_err(|error| {
            NativeVisionError::new("decode_failed", format!("FFmpeg init: {error}"), true)
        })?;
        let mut input = ffmpeg::format::input(file_path).map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Cannot open video: {error}"), true)
        })?;
        let stream = input
            .streams()
            .best(Type::Video)
            .ok_or_else(|| NativeVisionError::new("decode_failed", "No video stream", true))?;
        let stream_index = stream.index();
        let time_base = stream.time_base();
        let time_base_sec = time_base.numerator() as f64 / time_base.denominator() as f64;
        let avg_rate = stream.avg_frame_rate();
        let source_frame_rate = if avg_rate.denominator() != 0 {
            avg_rate.numerator() as f64 / avg_rate.denominator() as f64
        } else {
            30.0
        };
        let rotation = stream_rotation(&stream);
        let mut context = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
            .map_err(|error| {
                NativeVisionError::new("decode_failed", format!("Decoder context: {error}"), true)
            })?;
        let decode_threads = thread::available_parallelism()
            .map(|value| value.get().max(2))
            .unwrap_or(4);
        context.set_threading(ffmpeg::codec::threading::Config {
            kind: ffmpeg::codec::threading::Type::Frame,
            count: decode_threads,
        });
        let fast_decode_enabled = context.id() == ffmpeg::codec::Id::H264;
        let mut decoder_builder = context.decoder();
        if fast_decode_enabled {
            unsafe {
                (*decoder_builder.as_mut_ptr()).flags2 |= ffmpeg::ffi::AV_CODEC_FLAG2_FAST as i32;
            }
        }
        let mut decoder = decoder_builder.video().map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Video decoder: {error}"), true)
        })?;
        let source_width = decoder.width();
        let source_height = decoder.height();
        let (display_width, display_height) = if matches!(rotation, Rotation::R90 | Rotation::R270)
        {
            (source_height, source_width)
        } else {
            (source_width, source_height)
        };
        // Keep source detail through 1080p. SCRFD's full-frame pass still
        // letterboxes to 640, while its tiled passes consume native 640px
        // crops and therefore retain small-face detail.
        let (sample_raw_width, sample_raw_height) =
            scaler_dimensions_for_long_edge(source_width, source_height, 1920);
        let histogram_scale = (192.0 / source_width.max(source_height).max(1) as f64).min(1.0);
        let histogram_width =
            (((source_width as f64 * histogram_scale).round() as u32).max(2)) & !1;
        let histogram_height =
            (((source_height as f64 * histogram_scale).round() as u32).max(2)) & !1;
        let sample_scaler = Scaler::get(
            decoder.format(),
            source_width,
            source_height,
            Pixel::RGB24,
            sample_raw_width,
            sample_raw_height,
            Flags::BICUBIC,
        )
        .map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Sample scaler: {error}"), true)
        })?;
        let histogram_scaler = Scaler::get(
            decoder.format(),
            source_width,
            source_height,
            Pixel::RGB24,
            histogram_width,
            histogram_height,
            Flags::POINT,
        )
        .map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Histogram scaler: {error}"), true)
        })?;
        let histogram_frame =
            ffmpeg::frame::Video::new(Pixel::RGB24, histogram_width, histogram_height);
        let sample_frame =
            ffmpeg::frame::Video::new(Pixel::RGB24, sample_raw_width, sample_raw_height);
        let seek_target = (start_time * 1_000_000.0).round() as i64;
        input.seek(seek_target, ..seek_target).map_err(|error| {
            NativeVisionError::new("decode_failed", format!("Seek: {error}"), true)
        })?;
        decoder.flush();

        Ok(Self {
            input,
            decoder,
            stream_index,
            meta: DecodeSessionMeta {
                time_base_sec,
                start_time,
                end_time,
                total_duration: end_time - start_time,
                display_width,
                display_height,
                sample_raw_width,
                sample_raw_height,
                histogram_width,
                histogram_height,
                rotation,
            },
            state: DecodeFrameState {
                sample_scaler,
                histogram_scaler,
                histogram_frame,
                sample_frame,
                next_detection: start_time,
                next_face_bucket: start_time,
                shot_detector: AutoFlipShotBoundaryDetector::for_sample_rate(
                    source_frame_rate.max(1.0),
                ),
                pending_scene_cut: false,
                scene_cut_timestamps: Vec::new(),
                frame_timestamps: Vec::new(),
                static_feature_samples: Vec::new(),
                border_observations: Vec::new(),
                solid_background_frames: 0,
                solid_rgb_sum: (0, 0, 0),
                sample_count: 0,
                last_border_features: None,
                seen_keyframe: false,
                peak_face_queue: 0,
                peak_object_queue: 0,
                t_codec_decode_api: 0,
                t_histogram: 0,
                t_sample_scale: 0,
                t_copy_rotate: 0,
                t_border: 0,
                t_send: 0,
                decoded_frame_count: 0,
                histogram_sample_count: 0,
            },
            source_frame_rate,
            decode_threads,
            fast_decode_enabled,
            decode_started: Instant::now(),
        })
    }

    pub(crate) fn total_duration(&self) -> f64 {
        self.meta.total_duration
    }
}
