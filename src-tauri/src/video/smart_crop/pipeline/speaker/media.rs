use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{anyhow, ensure, Context, Result};
use ff::{codec, filter, format, frame, media::Type, software::scaling};
use ffmpeg_next as ff;

use super::super::super::decode::{scaler_dimensions_for_long_edge, stream_rotation};
use super::super::super::vision_logic::{NormalizedBox, Rotation};
use super::super::types::NativeSubjectSample;
use crate::video::ffmpeg::compatible_media::graph;

pub(super) const FPS: usize = 25;
pub(super) const SIDE: usize = 112;
pub(super) const AUDIO_SAMPLES_PER_FRAME: usize = 640; // 16000 Hz / 25 fps
const MAX_TINY_AUDIO_GAP_SAMPLES: usize = 8; // 0.5 ms rounding tolerance

pub(super) struct Inputs {
    pub faces: Vec<Vec<u8>>,
    pub pcm: Vec<f32>,
}

/// One bounded contiguous part of a shot. Decode all faces and audio together.
pub(super) struct Reader {
    input: format::context::Input,
    video: ff::decoder::Video,
    audio: ff::decoder::Audio,
    video_index: usize,
    audio_index: usize,
    video_tb: f64,
    audio_tb: ff::Rational,
    rotation: Rotation,
}

impl Reader {
    pub fn open(path: &str) -> Result<Self> {
        let input = format::input(path)?;
        let v = input.streams().best(Type::Video).context("missing video")?;
        let a = input.streams().best(Type::Audio).context("missing audio")?;
        let video = codec::context::Context::from_parameters(v.parameters())?
            .decoder()
            .video()?;
        let audio = codec::context::Context::from_parameters(a.parameters())?
            .decoder()
            .audio()?;
        let (video_index, audio_index, video_tb, audio_tb, rotation) = (
            v.index(),
            a.index(),
            f64::from(v.time_base()),
            a.time_base(),
            stream_rotation(&v),
        );
        Ok(Self {
            input,
            video,
            audio,
            video_index,
            audio_index,
            video_tb,
            audio_tb,
            rotation,
        })
    }

    pub fn read(
        &mut self,
        origin: f64,
        samples: &[NativeSubjectSample],
        ids: &[u64],
        cancel: &AtomicBool,
    ) -> Result<Inputs> {
        ensure!(samples.len() >= 2, "speaker block requires at least two samples");
        let start = origin + samples[0].time;
        let duration = samples.last().unwrap().time - samples[0].time;
        let n = ((duration * FPS as f64 + 1e-4).floor() as usize + 1).max(FPS);
        let mut data = Inputs {
            faces: ids
                .iter()
                .map(|_| Vec::with_capacity(n * SIDE * SIDE))
                .collect(),
            pcm: vec![f32::NAN; n * AUDIO_SAMPLES_PER_FRAME],
        };
        let seek_target = ((start - 0.1).max(0.0) * 1e6).round() as i64;
        self.input.seek(seek_target, ..seek_target.saturating_add(1))?;
        self.video.flush();
        self.audio.flush();
        let mut scaled = frame::Video::empty();
        let mut scaler = None;
        let mut audio_filter = None;
        let mut next = 0;
        let mut bracket = 0;
        let mut last_audio_end = f64::NEG_INFINITY;
        let audio_target_end = start + n as f64 / FPS as f64;
        let mut video_past = false;
        let mut audio_past = false;

        let mut receive_video = |decoder: &mut ff::decoder::Video, next: &mut usize| -> Result<()> {
            let mut decoded = frame::Video::empty();
            while received(decoder.receive_frame(&mut decoded))? {
                let Some(pts) = decoded.timestamp() else {
                    continue;
                };
                let time = pts as f64 * self.video_tb;
                if *next == n || time < start - 0.025 {
                    continue;
                }
                if scaler.is_none() {
                    let (w, h) =
                        scaler_dimensions_for_long_edge(decoded.width(), decoded.height(), 1280);
                    scaler = Some(scaling::Context::get(
                        decoded.format(),
                        decoded.width(),
                        decoded.height(),
                        format::Pixel::GRAY8,
                        w,
                        h,
                        scaling::Flags::BILINEAR,
                    )?);
                }
                scaler.as_mut().unwrap().run(&decoded, &mut scaled)?;
                while *next < n {
                    let relative = samples[0].time + *next as f64 / FPS as f64;
                    if origin + relative > time + 0.001 {
                        break;
                    }
                    ensure!(time - origin - relative < 0.15, "gap in source video");
                    while bracket + 1 < samples.len() - 1 && samples[bracket + 1].time < relative {
                        bracket += 1;
                    }
                    let left = &samples[bracket];
                    let right = &samples[bracket + 1];
                    let span = (right.time - left.time).max(1e-6);
                    let mix = ((relative - left.time) / span).clamp(0.0, 1.0) as f32;
                    for (i, id) in ids.iter().enumerate() {
                        let get_box = |s: &NativeSubjectSample| {
                            s.autoflip_faces
                                .iter()
                                .find(|f| f.track_id == Some(*id))
                                .map(|f| f.box_)
                                .ok_or_else(|| anyhow!("missing face observation"))
                        };
                        let a = get_box(left)?;
                        let b = get_box(right)?;
                        let lerp = |x, y| x + (y - x) * mix;
                        let bbox = NormalizedBox {
                            x: lerp(a.x, b.x),
                            y: lerp(a.y, b.y),
                            width: lerp(a.width, b.width),
                            height: lerp(a.height, b.height),
                        };
                        crop(&scaled, self.rotation, bbox, &mut data.faces[i]);
                    }
                    *next += 1;
                }
            }
            Ok(())
        };

        let mut receive_audio = |decoder: &mut ff::decoder::Audio,
                                 flush: bool,
                                 last_audio_end: &mut f64|
         -> Result<()> {
            let mut decoded = frame::Audio::empty();
            while received(decoder.receive_frame(&mut decoded))? {
                let Some(pts) = decoded.timestamp() else {
                    continue;
                };
                decoded.set_pts(Some(pts));
                let mut layout = decoded.channel_layout();
                if layout.is_empty() {
                    layout = ff::ChannelLayout::default(decoded.channels() as i32);
                    decoded.set_channel_layout(layout);
                }
                if audio_filter.is_none() {
                    let args = format!(
                        "time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
                        self.audio_tb,
                        decoded.rate(),
                        decoded.format().name(),
                        layout.bits()
                    );
                    audio_filter = Some(graph(
                        "abuffer",
                        &args,
                        "abuffersink",
                        "aresample=16000:async=1,aformat=sample_fmts=s16:channel_layouts=mono,asettb=1/16000",
                    )?);
                }
                let g = audio_filter.as_mut().unwrap();
                g.get("in").unwrap().source().add(&decoded)?;
                drain_audio(g, start, &mut data.pcm, last_audio_end)?;
            }
            if flush {
                if let Some(g) = audio_filter.as_mut() {
                    g.get("in").unwrap().source().flush()?;
                    drain_audio(g, start, &mut data.pcm, last_audio_end)?;
                }
            }
            Ok(())
        };

        let soft_cutoff = audio_target_end + 0.75;
        let hard_cutoff = audio_target_end + 3.0;
        for (stream, packet) in self.input.packets() {
            ensure!(!cancel.load(Ordering::Relaxed), "cancelled");
            let idx = stream.index();
            if idx != self.video_index && idx != self.audio_index {
                continue;
            }
            let packet_sec = packet
                .dts()
                .or_else(|| packet.pts())
                .map(|p| p as f64 * f64::from(stream.time_base()));
            if idx == self.video_index {
                self.video.send_packet(&packet)?;
                receive_video(&mut self.video, &mut next)?;
                if packet_sec.is_some_and(|t| t > soft_cutoff) {
                    video_past = true;
                }
            } else {
                self.audio.send_packet(&packet)?;
                receive_audio(&mut self.audio, false, &mut last_audio_end)?;
                if packet_sec.is_some_and(|t| t > soft_cutoff) {
                    audio_past = true;
                }
            }
            let video_done = next == n || video_past;
            let audio_done = last_audio_end >= audio_target_end || audio_past;
            if (video_done && audio_done) || packet_sec.is_some_and(|t| t > hard_cutoff) {
                break;
            }
        }
        self.video.send_eof()?;
        receive_video(&mut self.video, &mut next)?;
        self.audio.send_eof()?;
        receive_audio(&mut self.audio, true, &mut last_audio_end)?;
        ensure!(next == n, "incomplete video window ({next}/{n} frames)");
        fill_tiny_audio_gaps(&mut data.pcm);
        Ok(data)
    }
}

fn received(result: Result<(), ff::Error>) -> Result<bool> {
    match result {
        Ok(()) => Ok(true),
        Err(ff::Error::Eof) => Ok(false),
        Err(ff::Error::Other { errno }) if errno == ff::error::EAGAIN => Ok(false),
        Err(e) => Err(e.into()),
    }
}

fn drain_audio(
    graph: &mut filter::Graph,
    start: f64,
    pcm: &mut [f32],
    end: &mut f64,
) -> Result<()> {
    let mut frame = frame::Audio::empty();
    while received(graph.get("out").unwrap().sink().frame(&mut frame))? {
        let Some(pts) = frame.pts() else { continue };
        let offset = pts - (start * 16000.0).round() as i64;
        *end = (pts + frame.samples() as i64) as f64 / 16000.0;
        let first = (-offset).max(0) as usize;
        let dest = offset.max(0) as usize;
        let len = frame
            .samples()
            .saturating_sub(first)
            .min(pcm.len().saturating_sub(dest));
        if len > 0 {
            for (out, input) in pcm[dest..dest + len]
                .iter_mut()
                .zip(&frame.plane::<i16>(0)[first..first + len])
            {
                *out = *input as f32;
            }
        }
    }
    Ok(())
}

/// Fill isolated <=0.5 ms resampler timestamp rounding gaps between finite audio
/// samples without masking genuinely missing audio spans.
pub(super) fn fill_tiny_audio_gaps(pcm: &mut [f32]) {
    let mut i = 0;
    while i < pcm.len() {
        if pcm[i].is_finite() {
            i += 1;
            continue;
        }
        let start = i;
        while i < pcm.len() && !pcm[i].is_finite() {
            i += 1;
        }
        let gap = i - start;
        if gap <= MAX_TINY_AUDIO_GAP_SAMPLES && start > 0 && i < pcm.len() {
            let left = pcm[start - 1];
            let right = pcm[i];
            for (offset, slot) in pcm[start..i].iter_mut().enumerate() {
                let t = (offset + 1) as f32 / (gap + 1) as f32;
                *slot = left + (right - left) * t;
            }
        }
    }
}

pub(super) fn crop(gray: &frame::Video, rotation: Rotation, b: NormalizedBox, dest: &mut Vec<u8>) {
    let (w, h) = (gray.width() as i32, gray.height() as i32);
    let (dw, dh) = match rotation {
        Rotation::R90 | Rotation::R270 => (h, w),
        _ => (w, h),
    };
    // Central 112 pixels of upstream's 224px padded, downward-shifted face crop.
    let size = (b.width * dw as f32).max(b.height * dh as f32);
    let edge = size * 0.7;
    let left = (b.x + b.width / 2.0) * dw as f32 - edge / 2.0;
    let top = (b.y + b.height / 2.0) * dh as f32 + size * 0.2 - edge / 2.0;
    for row in 0..SIDE {
        for col in 0..SIDE {
            let x = (left + (col as f32 + 0.5) * edge / SIDE as f32).floor() as i32;
            let y = (top + (row as f32 + 0.5) * edge / SIDE as f32).floor() as i32;
            let (sx, sy) = match rotation {
                Rotation::R0 => (x, y),
                Rotation::R90 => (y, h - 1 - x),
                Rotation::R180 => (w - 1 - x, h - 1 - y),
                Rotation::R270 => (w - 1 - y, x),
            };
            let pixel = if (0..w).contains(&sx) && (0..h).contains(&sy) {
                gray.data(0)[sy as usize * gray.stride(0) + sx as usize]
            } else {
                110
            };
            dest.push(pixel);
        }
    }
}
