use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use super::super::diagnostics;
use super::super::vision::NativeVisionError;
use super::decode_frame::process_decoded_frame;
use super::decode_session::{DecodeSession, DecodeStats};
use super::setup::PipelineSetup;
use super::types::NativeVisionProgress;
use crate::video::ffmpeg::frames::should_decode_video_packet;

impl DecodeSession {
    pub(crate) fn run(
        &mut self,
        setup: &mut PipelineSetup,
        cancelled: Arc<AtomicBool>,
        progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
    ) -> Result<DecodeStats, NativeVisionError> {
        diagnostics::append(
            "decode",
            &format!(
                "packet loop start stream_index={} start={:.3} end={:.3}",
                self.stream_index, self.meta.start_time, self.meta.end_time
            ),
        );
        let mut decoded = ffmpeg_next::frame::Video::empty();
        let stream_index = self.stream_index;
        let meta = &self.meta;
        let mut reached_end = false;
        'packets: for (packet_stream, packet) in self.input.packets() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            if packet_stream.index() != stream_index {
                continue;
            }
            if !should_decode_video_packet(packet.is_key(), self.state.seen_keyframe) {
                continue;
            }
            self.state.seen_keyframe = true;
            let started = Instant::now();
            let sent = self.decoder.send_packet(&packet);
            self.state.t_codec_decode_api += started.elapsed().as_micros();
            if sent.is_err() {
                continue;
            }
            loop {
                let started = Instant::now();
                let received = self.decoder.receive_frame(&mut decoded);
                self.state.t_codec_decode_api += started.elapsed().as_micros();
                if received.is_err() {
                    break;
                }
                if process_decoded_frame(
                    &mut self.state,
                    meta,
                    &decoded,
                    setup,
                    &cancelled,
                    progress,
                )? {
                    reached_end = true;
                    break 'packets;
                }
            }
        }
        if !reached_end && !cancelled.load(Ordering::Relaxed) {
            let started = Instant::now();
            let _ = self.decoder.send_eof();
            self.state.t_codec_decode_api += started.elapsed().as_micros();
            loop {
                let started = Instant::now();
                let received = self.decoder.receive_frame(&mut decoded);
                self.state.t_codec_decode_api += started.elapsed().as_micros();
                if received.is_err() {
                    break;
                }
                if process_decoded_frame(
                    &mut self.state,
                    meta,
                    &decoded,
                    setup,
                    &cancelled,
                    progress,
                )? {
                    break;
                }
            }
        }
        diagnostics::append(
            "decode",
            &format!(
                "packet loop end reached_end={} cancelled={} decoded_frames={} sampled_frames={}",
                reached_end,
                cancelled.load(Ordering::Relaxed),
                self.state.decoded_frame_count,
                self.state.sample_count,
            ),
        );
        Ok(DecodeStats {
            sample_count: self.state.sample_count,
            decode_duration_ms: self.decode_started.elapsed().as_millis() as u64,
            peak_face_queue: self.state.peak_face_queue,
            peak_object_queue: self.state.peak_object_queue,
            t_codec_decode_api: self.state.t_codec_decode_api,
            t_histogram: self.state.t_histogram,
            t_sample_scale: self.state.t_sample_scale,
            t_copy_rotate: self.state.t_copy_rotate,
            t_border: self.state.t_border,
            t_send: self.state.t_send,
            decoded_frame_count: self.state.decoded_frame_count,
            histogram_sample_count: self.state.histogram_sample_count,
        })
    }
}
