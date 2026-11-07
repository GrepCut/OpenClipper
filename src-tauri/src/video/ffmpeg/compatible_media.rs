//! Bounded-memory recovery for files WebCodecs/Mediabunny cannot inspect.
use super::frames::ensure_ffmpeg_init;
use crate::clipper::data::CLIPPER_TRIMMED_SEGMENT_FILE;
use crate::video::smart_crop::{decode::stream_rotation, vision_logic::Rotation};
use ffmpeg::{codec, encoder, filter, format, frame, media::Type, Packet, Rational};
use ffmpeg_next as ffmpeg;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::UNIX_EPOCH,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibleMedia {
    pub file_path: String,
    pub source_revision: String,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("Media preparation cancelled".into())
    } else {
        Ok(())
    }
}

fn graph(source: &str, args: &str, sink: &str, spec: &str) -> Result<filter::Graph, ffmpeg::Error> {
    let mut graph = filter::Graph::new();
    graph.add(
        &filter::find(source).ok_or(ffmpeg::Error::FilterNotFound)?,
        "in",
        args,
    )?;
    graph.add(
        &filter::find(sink).ok_or(ffmpeg::Error::FilterNotFound)?,
        "out",
        "",
    )?;
    graph.output("in", 0)?.input("out", 0)?.parse(spec)?;
    graph.validate()?;
    Ok(graph)
}

fn drain_packets(
    encoder: &mut codec::encoder::Encoder,
    index: usize,
    time_base: Rational,
    output: &mut format::context::Output,
) -> Result<(), ffmpeg::Error> {
    let mut packet = Packet::empty();
    loop {
        match encoder.receive_packet(&mut packet) {
            Ok(()) => {
                packet.set_stream(index);
                packet.set_position(-1);
                packet.rescale_ts(
                    time_base,
                    output
                        .stream(index)
                        .ok_or(ffmpeg::Error::StreamNotFound)?
                        .time_base(),
                );
                packet.write_interleaved(output)?;
            }
            Err(ffmpeg::Error::Eof) => break,
            Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => break,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

struct VideoPipe {
    decoder: ffmpeg::decoder::Video,
    encoder: encoder::Video,
    graph: Option<filter::Graph>,
    spec: String,
    tb: Rational,
    index: usize,
    width: u32,
    height: u32,
    frames: usize,
}

impl VideoPipe {
    fn new(
        stream: &ffmpeg::Stream<'_>,
        output: &mut format::context::Output,
        origin: f64,
    ) -> Result<Self, String> {
        let decoder = codec::context::Context::from_parameters(stream.parameters())
            .and_then(|c| c.decoder().video())
            .map_err(|e| e.to_string())?;
        let codec = encoder::find_by_name("h264_mf")
            .ok_or("H.264 Media Foundation encoder is unavailable. Update Windows and retry.")?;
        let mut encoder = codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()
            .map_err(|e| e.to_string())?;
        let sar = decoder.aspect_ratio();
        let pixel_ratio = if sar.numerator() > 0 && sar.denominator() > 0 {
            f64::from(sar)
        } else {
            1.0
        };
        let w = ((decoder.width() as f64 * pixel_ratio / 2.0).ceil() as u32).max(1) * 2;
        let h = decoder.height().div_ceil(2) * 2;
        if decoder.width() == 0 || decoder.height() == 0 {
            return Err("Source video dimensions could not be read".into());
        }
        let rotation = stream_rotation(stream);
        let (width, height) = if matches!(rotation, Rotation::R90 | Rotation::R270) {
            (h, w)
        } else {
            (w, h)
        };
        let rotate = match rotation {
            Rotation::R90 => "transpose=clock,",
            Rotation::R180 => "hflip,vflip,",
            Rotation::R270 => "transpose=cclock,",
            _ => "",
        };
        encoder.set_width(width);
        encoder.set_height(height);
        encoder.set_format(format::Pixel::NV12);
        encoder.set_aspect_ratio((1, 1));
        encoder.set_time_base(stream.time_base());
        let rate = stream.avg_frame_rate();
        encoder.set_frame_rate(Some(if rate.numerator() > 0 && rate.denominator() > 0 {
            rate
        } else {
            Rational(30, 1)
        }));
        encoder.set_bit_rate((width as usize * height as usize * 6).clamp(4_000_000, 50_000_000));
        encoder.set_max_b_frames(0);
        encoder.set_flags(codec::Flags::GLOBAL_HEADER);
        let mut opts = ffmpeg::Dictionary::new();
        opts.set("hw_encoding", "0");
        let encoder = encoder.open_as_with(codec, opts).map_err(|e| {
            format!("Cannot start H.264 recovery encoder: {e}. Your original file is preserved.")
        })?;
        let mut out = output.add_stream(codec).map_err(|e| e.to_string())?;
        out.set_time_base(stream.time_base());
        out.set_parameters(&encoder);
        Ok(Self {
            decoder,
            encoder,
            graph: None,
            tb: stream.time_base(),
            index: out.index(),
            width,
            height,
            frames: 0,
            spec: format!(
                "setpts=PTS-{origin}/TB,{rotate}scale={width}:{height},setsar=1,format=nv12"
            ),
        })
    }

    fn receive(
        &mut self,
        output: &mut format::context::Output,
        cancel: &AtomicBool,
        progress: &mut impl FnMut(f64) -> Result<(), String>,
        duration: f64,
    ) -> Result<(), String> {
        let mut decoded = frame::Video::empty();
        loop {
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => {}
                Err(ffmpeg::Error::Eof) => break,
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => break,
                Err(e) => return Err(format!("Cannot decode source video: {e}")),
            }
            check_cancel(cancel)?;
            let timestamp = decoded.timestamp();
            decoded.set_pts(timestamp);
            if self.graph.is_none() {
                let pixel_format: ffmpeg::ffi::AVPixelFormat = decoded.format().into();
                let args = format!(
                    "video_size={}x{}:pix_fmt={}:time_base={}:pixel_aspect=1/1",
                    decoded.width(),
                    decoded.height(),
                    pixel_format as i32,
                    self.tb
                );
                self.graph = Some(
                    graph("buffer", &args, "buffersink", &self.spec).map_err(|e| e.to_string())?,
                );
            }
            self.graph
                .as_mut()
                .unwrap()
                .get("in")
                .unwrap()
                .source()
                .add(&decoded)
                .map_err(|e| e.to_string())?;
            self.filtered(output, cancel, progress, duration)?;
        }
        Ok(())
    }

    fn filtered(
        &mut self,
        output: &mut format::context::Output,
        cancel: &AtomicBool,
        progress: &mut impl FnMut(f64) -> Result<(), String>,
        duration: f64,
    ) -> Result<(), String> {
        let Some(graph) = self.graph.as_mut() else {
            return Ok(());
        };
        let mut filtered = frame::Video::empty();
        loop {
            match graph.get("out").unwrap().sink().frame(&mut filtered) {
                Ok(()) => {}
                Err(ffmpeg::Error::Eof) => break,
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => break,
                Err(e) => return Err(e.to_string()),
            }
            check_cancel(cancel)?;
            filtered.set_kind(ffmpeg::picture::Type::None);
            let t = filtered.pts().unwrap_or(0) as f64 * f64::from(self.tb);
            self.encoder
                .send_frame(&filtered)
                .map_err(|e| e.to_string())?;
            self.frames += 1;
            drain_packets(&mut self.encoder, self.index, self.tb, output)
                .map_err(|e| e.to_string())?;
            progress((t / duration.max(0.001)).clamp(0.0, 0.99))?;
        }
        Ok(())
    }
}

struct AudioPipe {
    decoder: ffmpeg::decoder::Audio,
    encoder: encoder::Audio,
    graph: Option<filter::Graph>,
    tb: Rational,
    origin: f64,
    channels: i32,
    index: usize,
}

impl AudioPipe {
    fn new(
        stream: &ffmpeg::Stream<'_>,
        output: &mut format::context::Output,
        origin: f64,
    ) -> Result<Self, String> {
        let decoder = codec::context::Context::from_parameters(stream.parameters())
            .and_then(|c| c.decoder().audio())
            .map_err(|e| e.to_string())?;
        let codec = encoder::find(codec::Id::AAC).ok_or("AAC recovery encoder is unavailable")?;
        let mut encoder = codec::context::Context::new_with_codec(codec)
            .encoder()
            .audio()
            .map_err(|e| e.to_string())?;
        let channels = if decoder.channels() == 1 { 1 } else { 2 };
        encoder.set_channel_layout(if channels == 1 {
            ffmpeg::ChannelLayout::MONO
        } else {
            ffmpeg::ChannelLayout::STEREO
        });
        encoder.set_rate(48_000);
        encoder.set_format(format::Sample::F32(format::sample::Type::Planar));
        encoder.set_time_base((1, 48_000));
        encoder.set_bit_rate(192_000);
        encoder.set_flags(codec::Flags::GLOBAL_HEADER);
        let encoder = encoder.open_as(codec).map_err(|e| e.to_string())?;
        let mut out = output.add_stream(codec).map_err(|e| e.to_string())?;
        out.set_time_base((1, 48_000));
        out.set_parameters(&encoder);
        Ok(Self {
            decoder,
            encoder,
            graph: None,
            tb: stream.time_base(),
            origin,
            channels,
            index: out.index(),
        })
    }

    fn receive(
        &mut self,
        output: &mut format::context::Output,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let mut decoded = frame::Audio::empty();
        loop {
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => {}
                Err(ffmpeg::Error::Eof) => break,
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => break,
                Err(e) => return Err(format!("Cannot decode source audio: {e}")),
            }
            check_cancel(cancel)?;
            let timestamp = decoded.timestamp();
            decoded.set_pts(timestamp);
            if self.graph.is_none() {
                let layout = decoded.channel_layout();
                let layout = if layout.is_empty() {
                    ffmpeg::ChannelLayout::default(decoded.channels() as i32)
                } else {
                    layout
                };
                decoded.set_channel_layout(layout);
                let args = format!(
                    "time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
                    self.tb,
                    decoded.rate(),
                    decoded.format().name(),
                    layout.bits()
                );
                let layout_name = if self.channels == 1 { "mono" } else { "stereo" };
                let spec = format!("asetpts=PTS-{}/TB,aresample=48000,aformat=sample_fmts=fltp:channel_layouts={layout_name}", self.origin);
                let mut g =
                    graph("abuffer", &args, "abuffersink", &spec).map_err(|e| e.to_string())?;
                g.get("out")
                    .unwrap()
                    .sink()
                    .set_frame_size(self.encoder.frame_size());
                self.graph = Some(g);
            }
            self.graph
                .as_mut()
                .unwrap()
                .get("in")
                .unwrap()
                .source()
                .add(&decoded)
                .map_err(|e| e.to_string())?;
            self.filtered(output, cancel)?;
        }
        Ok(())
    }

    fn filtered(
        &mut self,
        output: &mut format::context::Output,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let Some(graph) = self.graph.as_mut() else {
            return Ok(());
        };
        let mut filtered = frame::Audio::empty();
        loop {
            match graph.get("out").unwrap().sink().frame(&mut filtered) {
                Ok(()) => {}
                Err(ffmpeg::Error::Eof) => break,
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => break,
                Err(e) => return Err(e.to_string()),
            }
            check_cancel(cancel)?;
            self.encoder
                .send_frame(&filtered)
                .map_err(|e| e.to_string())?;
            drain_packets(&mut self.encoder, self.index, Rational(1, 48_000), output)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn source_revision(source: &Path) -> Result<String, String> {
    let source = source
        .canonicalize()
        .map_err(|e| format!("Source video is missing or inaccessible: {e}"))?;
    let metadata = fs::metadata(&source).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let key = format!("v1|{}|{}|{modified}", source.display(), metadata.len());
    Ok(format!("{:x}", Sha256::digest(key.as_bytes())))
}

/// Publish a WebCodecs-verified copy as the derived range used by resume and Studio.
/// The external source is never touched, and rename failure preserves the old range.
pub(crate) fn commit_prepared_range(
    directory: &Path,
    prepared_file_name: &str,
    revision: &str,
) -> Result<String, String> {
    if revision.len() != 64 || !revision.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid prepared source revision".into());
    }
    let expected_name = format!("compatible-{}.mp4", &revision[..24]);
    if prepared_file_name != expected_name {
        return Err("Prepared file does not match the source revision".into());
    }
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    let source = directory.join(CLIPPER_TRIMMED_SEGMENT_FILE);
    if source.canonicalize().map_err(|e| e.to_string())? != source {
        return Err("Range source must be a file in project data".into());
    }
    if source_revision(&source)? != revision {
        return Err("Range source changed during media preparation. Retry the operation.".into());
    }
    let candidate = directory.join(prepared_file_name);
    if candidate.canonicalize().map_err(|e| e.to_string())? != candidate || !candidate.is_file() {
        return Err("Prepared video must be a file in project data".into());
    }
    // Both files are in the same directory. Do not remove the old range first.
    fs::rename(&candidate, &source).map_err(|e| format!("Cannot commit prepared range: {e}"))?;
    Ok(source.to_string_lossy().into())
}

pub fn prepare(
    source: &Path,
    directory: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(f64) -> Result<(), String>,
) -> Result<CompatibleMedia, String> {
    check_cancel(cancel)?;
    ensure_ffmpeg_init()?;
    let source = source
        .canonicalize()
        .map_err(|e| format!("Source video is missing or inaccessible: {e}"))?;
    let fingerprint = source_revision(&source)?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let destination = directory.join(format!("compatible-{}.mp4", &fingerprint[..24]));
    let partial = directory.join(format!("compatible-{}.part.mp4", uuid::Uuid::new_v4()));
    let mut input = format::input(&source).map_err(|e| format!("Cannot open source video: {e}"))?;
    let video_index = input
        .streams()
        .best(Type::Video)
        .ok_or("No video track found in source")?
        .index();
    let audio_index = input.streams().best(Type::Audio).map(|s| s.index());
    let start = unsafe { (*input.as_ptr()).start_time };
    let origin = if start == ffmpeg::ffi::AV_NOPTS_VALUE {
        0.0
    } else {
        start as f64 / 1_000_000.0
    };
    let duration = (input.duration() as f64 / 1_000_000.0).max(0.001);
    if destination.is_file() {
        let cached = format::input(&destination).map_err(|e| e.to_string())?;
        let track = cached
            .streams()
            .best(Type::Video)
            .ok_or("Invalid prepared video")?;
        let decoder = codec::context::Context::from_parameters(track.parameters())
            .and_then(|c| c.decoder().video())
            .map_err(|e| e.to_string())?;
        progress(1.0)?;
        return Ok(CompatibleMedia {
            file_path: destination.to_string_lossy().into(),
            source_revision: fingerprint,
            duration_sec: duration,
            width: decoder.width(),
            height: decoder.height(),
            has_audio: cached.streams().best(Type::Audio).is_some(),
        });
    }
    let result = (|| {
        let mut output = format::output(&partial).map_err(|e| e.to_string())?;
        let mut video_pipe = VideoPipe::new(
            &input.stream(video_index).ok_or("Missing source video")?,
            &mut output,
            origin,
        )?;
        let mut audio_pipe = audio_index
            .map(|i| AudioPipe::new(&input.stream(i).unwrap(), &mut output, origin))
            .transpose()?;
        let mut opts = ffmpeg::Dictionary::new();
        opts.set("movflags", "faststart");
        output.write_header_with(opts).map_err(|e| e.to_string())?;
        loop {
            check_cancel(cancel)?;
            // av_read_frame does not release a previously populated packet in FFmpeg 8.
            // Keep ownership inside the iteration so every path drops its buffer.
            let mut packet = Packet::empty();
            match packet.read(&mut input) {
                Ok(()) => {}
                Err(ffmpeg::Error::Eof) => break,
                Err(e) => return Err(format!("Cannot read source video: {e}")),
            }
            if packet.stream() == video_index {
                video_pipe
                    .decoder
                    .send_packet(&packet)
                    .map_err(|e| e.to_string())?;
                video_pipe.receive(&mut output, cancel, &mut progress, duration)?;
            } else if Some(packet.stream()) == audio_index {
                let pipe = audio_pipe.as_mut().unwrap();
                pipe.decoder
                    .send_packet(&packet)
                    .map_err(|e| e.to_string())?;
                pipe.receive(&mut output, cancel)?;
            }
        }
        video_pipe.decoder.send_eof().map_err(|e| e.to_string())?;
        video_pipe.receive(&mut output, cancel, &mut progress, duration)?;
        if let Some(g) = video_pipe.graph.as_mut() {
            g.get("in")
                .unwrap()
                .source()
                .flush()
                .map_err(|e| e.to_string())?;
        }
        video_pipe.filtered(&mut output, cancel, &mut progress, duration)?;
        if video_pipe.frames == 0 {
            return Err(
                "No video frames could be recovered. Your original file is preserved.".into(),
            );
        }
        video_pipe.encoder.send_eof().map_err(|e| e.to_string())?;
        drain_packets(
            &mut video_pipe.encoder,
            video_pipe.index,
            video_pipe.tb,
            &mut output,
        )
        .map_err(|e| e.to_string())?;
        if let Some(pipe) = audio_pipe.as_mut() {
            pipe.decoder.send_eof().map_err(|e| e.to_string())?;
            pipe.receive(&mut output, cancel)?;
            if let Some(g) = pipe.graph.as_mut() {
                g.get("in")
                    .unwrap()
                    .source()
                    .flush()
                    .map_err(|e| e.to_string())?;
            }
            pipe.filtered(&mut output, cancel)?;
            pipe.encoder.send_eof().map_err(|e| e.to_string())?;
            drain_packets(
                &mut pipe.encoder,
                pipe.index,
                Rational(1, 48_000),
                &mut output,
            )
            .map_err(|e| e.to_string())?;
        }
        check_cancel(cancel)?;
        output.write_trailer().map_err(|e| e.to_string())?;
        drop(output);
        check_cancel(cancel)?;
        // Another request may have prepared the same immutable source while we worked.
        if !destination.is_file() {
            fs::rename(&partial, &destination).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&partial).map_err(|e| e.to_string())?;
        }
        progress(1.0)?;
        Ok(CompatibleMedia {
            file_path: destination.to_string_lossy().into(),
            source_revision: fingerprint,
            duration_sec: duration,
            width: video_pipe.width,
            height: video_pipe.height,
            has_audio: audio_pipe.is_some(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("clipper-repair-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn pending_range(&self) -> (String, String) {
            fs::write(self.0.join(CLIPPER_TRIMMED_SEGMENT_FILE), b"old range").unwrap();
            let revision = source_revision(&self.0.join(CLIPPER_TRIMMED_SEGMENT_FILE)).unwrap();
            let name = format!("compatible-{}.mp4", &revision[..24]);
            fs::write(self.0.join(&name), b"verified range").unwrap();
            (name, revision)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn commit_replaces_derived_range_and_preserves_original_and_metadata() {
        let root = Fixture::new();
        let (name, revision) = root.pending_range();
        fs::write(root.0.join("original.mp4"), b"external original").unwrap();
        fs::write(
            root.0.join("trim_metadata.json"),
            br#"{"clipStart":0,"clipEnd":1}"#,
        )
        .unwrap();
        let path = commit_prepared_range(&root.0, &name, &revision).unwrap();
        assert_eq!(fs::read(path).unwrap(), b"verified range");
        assert!(!root.0.join(name).exists());
        assert_eq!(
            fs::read(root.0.join("original.mp4")).unwrap(),
            b"external original"
        );
        assert_eq!(
            fs::read(root.0.join("trim_metadata.json")).unwrap(),
            br#"{"clipStart":0,"clipEnd":1}"#
        );
    }

    #[test]
    fn commit_rejects_changed_source_and_invalid_candidate_without_losing_files() {
        let root = Fixture::new();
        let (name, revision) = root.pending_range();
        assert!(commit_prepared_range(&root.0, &format!("../{name}"), &revision).is_err());
        assert!(commit_prepared_range(&root.0, &name, "bad revision").is_err());
        let source = root.0.join(CLIPPER_TRIMMED_SEGMENT_FILE);
        fs::write(&source, b"a newly selected range").unwrap();
        let error = commit_prepared_range(&root.0, &name, &revision).unwrap_err();
        assert!(error.contains("changed during"));
        assert_eq!(fs::read(&source).unwrap(), b"a newly selected range");
        assert_eq!(fs::read(root.0.join(name)).unwrap(), b"verified range");
    }

    #[test]
    fn commit_failure_preserves_the_old_range_and_the_verified_candidate() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = Fixture::new();
        let (name, revision) = root.pending_range();
        let source = root.0.join(CLIPPER_TRIMMED_SEGMENT_FILE);
        // Permit reads and writes, but deny deletion/replacement while the handle is open.
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&source)
            .unwrap();
        let error = commit_prepared_range(&root.0, &name, &revision).unwrap_err();
        assert!(error.contains("Cannot commit"), "{error}");
        drop(lock);
        assert_eq!(fs::read(&source).unwrap(), b"old range");
        assert_eq!(fs::read(root.0.join(&name)).unwrap(), b"verified range");
        fs::remove_file(root.0.join(&name)).unwrap();
        assert!(commit_prepared_range(&root.0, &name, &revision).is_err());
        assert_eq!(fs::read(source).unwrap(), b"old range");
    }

    #[test]
    #[ignore = "requires FFmpeg CLI and Windows Media Foundation; run explicitly on Windows"]
    fn repair_commit_reopen_and_studio_use_the_same_compatible_range() {
        let root = Fixture::new();
        let original = root.0.join("original.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x240:rate=30",
                "-t",
                "1.2",
                "-c:v",
                "mpeg4",
            ])
            .arg(&original)
            .status()
            .unwrap()
            .success());
        let original_bytes = fs::read(&original).unwrap();
        let directory = root.0.join("data");
        fs::create_dir(&directory).unwrap();
        let source = directory.join(CLIPPER_TRIMMED_SEGMENT_FILE);
        fs::copy(&original, &source).unwrap();
        let cancel = AtomicBool::new(false);
        let repaired = prepare(&source, &directory, &cancel, |_| Ok(())).unwrap();
        // Legacy cache files are reusable before publication.
        let cached = prepare(&source, &directory, &cancel, |_| Ok(())).unwrap();
        assert_eq!(repaired.source_revision, cached.source_revision);
        let name = Path::new(&repaired.file_path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        commit_prepared_range(&directory, name, &repaired.source_revision).unwrap();
        let reopened = format::input(&source).unwrap();
        assert_eq!(
            reopened
                .streams()
                .best(Type::Video)
                .unwrap()
                .parameters()
                .id(),
            codec::Id::H264
        );
        drop(reopened);
        let cut =
            super::super::studio_clip::extract_studio_clip_blocking(&directory, 0.0, 1.0).unwrap();
        let studio = format::input(&directory.join(cut.file_name)).unwrap();
        assert_eq!(
            studio
                .streams()
                .best(Type::Video)
                .unwrap()
                .parameters()
                .id(),
            codec::Id::H264
        );
        assert_eq!(fs::read(original).unwrap(), original_bytes);
    }

    #[test]
    #[ignore = "FFmpeg/MF memory regression; run alone with --ignored --nocapture --test-threads=1"]
    fn long_repair_keeps_packet_memory_bounded() {
        use crate::video::smart_crop::diagnostics::resource_counters;
        let root = Fixture::new();
        let source = root.0.join("raw.nut");
        // ~297 MiB of raw packets: the previous leak exceeds the allowance below.
        assert!(Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=30",
                "-t",
                "30",
                "-c:v",
                "rawvideo",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .unwrap()
            .success());
        assert!(fs::metadata(&source).unwrap().len() > 280 * 1024 * 1024);
        let mut baseline = None;
        let mut peak = 0;
        prepare(
            &source,
            &root.0.join("output"),
            &AtomicBool::new(false),
            |ratio| {
                if ratio >= 0.25 {
                    let private = resource_counters()
                        .expect("Windows process memory counters")
                        .private_commit_mib;
                    baseline.get_or_insert(private);
                    peak = peak.max(private);
                }
                Ok(())
            },
        )
        .unwrap();
        let baseline = baseline.expect("reached the warm-up boundary");
        eprintln!("native repair private commit: baseline={baseline} MiB peak={peak} MiB");
        assert!(
            peak <= baseline + 64,
            "Memory grew by {} MiB after warm-up",
            peak - baseline
        );
    }

    #[test]
    fn cancellation_does_not_create_project_files() {
        let directory =
            std::env::temp_dir().join(format!("clipper-repair-{}", uuid::Uuid::new_v4()));
        let error = prepare(
            Path::new("missing.mp4"),
            &directory,
            &AtomicBool::new(true),
            |_| Ok(()),
        )
        .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(!directory.exists());
    }

    #[test]
    #[ignore = "requires FFmpeg CLI and Windows Media Foundation; run explicitly on Windows"]
    fn repairs_mpeg4_and_96khz_audio_reuses_cache_and_cleans_cancelled_jobs() {
        let root =
            std::env::temp_dir().join(format!("clipper-repair-smoke-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mov");
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x240:rate=30000/1001",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=96000",
                "-t",
                "1.2",
                "-c:v",
                "mpeg4",
                "-q:v",
                "3",
                "-c:a",
                "pcm_s16le",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        let output = root.join("output");
        let cancel = AtomicBool::new(false);
        let result = prepare(&source, &output, &cancel, |_| Ok(())).unwrap();
        assert_eq!((result.width, result.height), (320, 240));
        assert!(result.has_audio);
        let input = format::input(&result.file_path).unwrap();
        let audio = input.streams().best(Type::Audio).unwrap();
        assert_eq!(audio.parameters().id(), codec::Id::AAC);
        let decoder = codec::context::Context::from_parameters(audio.parameters())
            .unwrap()
            .decoder()
            .audio()
            .unwrap();
        assert_eq!(decoder.rate(), 48_000);
        assert_eq!(decoder.channels(), 1);
        assert_eq!(
            input.streams().best(Type::Video).unwrap().parameters().id(),
            codec::Id::H264
        );
        assert!((input.duration() as f64 / 1_000_000.0 - 1.2).abs() < 0.1);
        drop(input);
        let cached = prepare(&source, &output, &cancel, |_| Ok(())).unwrap();
        assert_eq!(result.file_path, cached.file_path);
        assert_eq!(fs::read_dir(&output).unwrap().count(), 1);
        let cancelled_dir = root.join("cancelled");
        assert!(prepare(&source, &cancelled_dir, &cancel, |ratio| {
            if ratio >= 0.2 {
                cancel.store(true, Ordering::Release);
            }
            Ok(())
        })
        .is_err());
        assert_eq!(fs::read_dir(&cancelled_dir).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
}
