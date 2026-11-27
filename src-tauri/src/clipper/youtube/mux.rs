use super::{check_cancel, ImportError};
use crate::video::ffmpeg::frames::ensure_ffmpeg_init;
use ffmpeg::{codec, format, media::Type, Packet, Rational};
use ffmpeg_next as ffmpeg;
use std::{path::Path, sync::atomic::AtomicBool};

const MEDIA_ERROR: ImportError = ImportError::new(
    "mp4_mux_failed",
    "prepare",
    "Could not prepare this video for editing. Try again or choose a video file.",
);

struct Track {
    input: format::context::Input,
    stream: usize,
    time_base: Rational,
    saw_packet: bool,
}

impl Track {
    fn open(path: &Path, medium: Type, codec: codec::Id) -> Result<Self, ImportError> {
        let mut options = ffmpeg::Dictionary::new();
        options.set("protocol_whitelist", "file");
        options.set("format_whitelist", "mov");
        options.set("enable_drefs", "0");
        let input = format::input_with_dictionary(path, options).map_err(|_| MEDIA_ERROR)?;
        let stream = input
            .streams()
            .best(medium)
            .filter(|stream| stream.parameters().id() == codec)
            .ok_or(MEDIA_ERROR)?;
        let (index, time_base) = (stream.index(), stream.time_base());
        Ok(Self {
            input,
            stream: index,
            time_base,
            saw_packet: false,
        })
    }

    fn next(&mut self, cancelled: &AtomicBool) -> Result<Option<Packet>, ImportError> {
        let mut packet = Packet::empty();
        loop {
            check_cancel(cancelled)?;
            match packet.read(&mut self.input) {
                Ok(()) if packet.stream() == self.stream && packet.size() > 0 => {
                    self.saw_packet = true;
                    return Ok(Some(packet));
                }
                Ok(()) => packet = Packet::empty(),
                Err(ffmpeg::Error::Eof) => return Ok(None),
                Err(_) => return Err(MEDIA_ERROR),
            }
        }
    }

    fn connect(&self, output: &mut format::context::Output) -> Result<(), ImportError> {
        let parameters = self
            .input
            .stream(self.stream)
            .ok_or(MEDIA_ERROR)?
            .parameters();
        let mut stream = output
            .add_stream(ffmpeg::encoder::find(codec::Id::None))
            .map_err(|_| MEDIA_ERROR)?;
        stream.set_parameters(parameters);
        stream.set_time_base(self.time_base);
        Ok(())
    }
}

fn seconds(packet: &Packet, time_base: Rational) -> f64 {
    packet.dts().or_else(|| packet.pts()).unwrap_or_default() as f64 * f64::from(time_base)
}

fn write_packet(
    mut packet: Packet,
    original_time_base: Rational,
    output_stream: usize,
    output: &mut format::context::Output,
) -> Result<(), ImportError> {
    let time_base = output.stream(output_stream).ok_or(MEDIA_ERROR)?.time_base();
    packet.rescale_ts(original_time_base, time_base);
    packet.set_stream(output_stream);
    packet.set_position(-1);
    packet
        .write_interleaved(output)
        .map_err(|error| match error {
            ffmpeg::Error::Other { errno } if errno == ffmpeg::error::ENOSPC => ImportError::new(
                "disk_full",
                "save",
                "There is not enough space to save this video.",
            ),
            _ => MEDIA_ERROR,
        })
}

pub(super) fn prepare(
    video_path: &Path,
    audio_path: Option<&Path>,
    output_path: &Path,
    cancelled: &AtomicBool,
) -> Result<(), ImportError> {
    ensure_ffmpeg_init().map_err(|_| MEDIA_ERROR)?;
    let mut video = Track::open(video_path, Type::Video, codec::Id::H264)?;
    let mut audio = Track::open(
        audio_path.unwrap_or(video_path),
        Type::Audio,
        codec::Id::AAC,
    )?;
    let mut output = format::output(output_path).map_err(|_| MEDIA_ERROR)?;
    video.connect(&mut output)?;
    audio.connect(&mut output)?;
    let mut options = ffmpeg::Dictionary::new();
    options.set("movflags", "faststart");
    output.write_header_with(options).map_err(|_| MEDIA_ERROR)?;
    let mut video_packet = video.next(cancelled)?;
    let mut audio_packet = audio.next(cancelled)?;
    loop {
        let write_video = match (&video_packet, &audio_packet) {
            (Some(v), Some(a)) => seconds(v, video.time_base) <= seconds(a, audio.time_base),
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => break,
        };
        if write_video {
            write_packet(
                video_packet.take().ok_or(MEDIA_ERROR)?,
                video.time_base,
                0,
                &mut output,
            )?;
            video_packet = video.next(cancelled)?;
        } else {
            write_packet(
                audio_packet.take().ok_or(MEDIA_ERROR)?,
                audio.time_base,
                1,
                &mut output,
            )?;
            audio_packet = audio.next(cancelled)?;
        }
    }
    if !video.saw_packet || !audio.saw_packet {
        return Err(MEDIA_ERROR);
    }
    output.write_trailer().map_err(|_| MEDIA_ERROR)?;
    drop(output);
    let verification = Track::open(output_path, Type::Video, codec::Id::H264)?;
    if verification.input.duration() <= 0
        || verification.input.streams().best(Type::Audio).is_none()
    {
        return Err(MEDIA_ERROR);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remuxes_and_validates_separate_video_and_audio_tracks() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/youtube-import");
        let output =
            std::env::temp_dir().join(format!("openclipper-mux-{}.mp4", uuid::Uuid::new_v4()));
        let result = prepare(
            &root.join("video.mp4"),
            Some(&root.join("audio.m4a")),
            &output,
            &AtomicBool::new(false),
        );
        let _ = std::fs::remove_file(output);
        result.unwrap();
    }
}
