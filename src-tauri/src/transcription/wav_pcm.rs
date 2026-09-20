//! Stream a WAV as mono f32 windows so ASR can decode long files without
//! loading the full soundtrack into memory.

use super::types::TranscriptionError;
use hound::{SampleFormat, WavReader};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

pub struct WavPcmSource {
    reader: WavReader<BufReader<File>>,
    sample_rate: u32,
    channels: u16,
    sample_format: SampleFormat,
    bits_per_sample: u16,
    frame_count: u32,
}

impl WavPcmSource {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, TranscriptionError> {
        let reader = WavReader::open(path.as_ref()).map_err(|error| {
            TranscriptionError::InvalidAudio(format!("Failed to read audio: {error}"))
        })?;
        let spec = reader.spec();
        if spec.sample_rate == 0 || spec.sample_rate > i32::MAX as u32 {
            return Err(TranscriptionError::InvalidAudio(
                "Audio has an invalid sample rate".into(),
            ));
        }
        if spec.channels == 0 {
            return Err(TranscriptionError::InvalidAudio(
                "Audio has no channels".into(),
            ));
        }
        Ok(Self {
            frame_count: reader.duration(),
            sample_rate: spec.sample_rate,
            channels: spec.channels,
            sample_format: spec.sample_format,
            bits_per_sample: spec.bits_per_sample,
            reader,
        })
    }

    pub fn sample_rate(&self) -> i32 {
        self.sample_rate as i32
    }

    pub fn duration_ms(&self) -> u64 {
        duration_ms(u64::from(self.frame_count), self.sample_rate)
    }

    pub fn chunk_count(&self, chunk_seconds: usize) -> usize {
        chunk_count(u64::from(self.frame_count), self.sample_rate, chunk_seconds)
    }

    pub fn next_mono_chunk(
        &mut self,
        frame_count: usize,
    ) -> Result<Option<Vec<f32>>, TranscriptionError> {
        if frame_count == 0 {
            return Ok(None);
        }
        let channels = self.channels as usize;
        let needed = frame_count.saturating_mul(channels);
        let mut interleaved = Vec::with_capacity(needed);
        match self.sample_format {
            SampleFormat::Float => self.read_float_samples(needed, &mut interleaved)?,
            SampleFormat::Int => self.read_int_samples(needed, &mut interleaved)?,
        }
        let mono = to_mono(&interleaved, channels);
        if mono.is_empty() {
            return Ok(None);
        }
        Ok(Some(mono))
    }

    fn read_float_samples(
        &mut self,
        needed: usize,
        dest: &mut Vec<f32>,
    ) -> Result<(), TranscriptionError> {
        for sample in self.reader.samples::<f32>().take(needed) {
            dest.push(sample.map_err(|error| {
                TranscriptionError::InvalidAudio(format!("Failed to read audio: {error}"))
            })?);
        }
        Ok(())
    }

    fn read_int_samples(
        &mut self,
        needed: usize,
        dest: &mut Vec<f32>,
    ) -> Result<(), TranscriptionError> {
        let scale = int_sample_scale(self.bits_per_sample);
        for sample in self.reader.samples::<i32>().take(needed) {
            let value = sample.map_err(|error| {
                TranscriptionError::InvalidAudio(format!("Failed to read audio: {error}"))
            })?;
            dest.push(value as f32 / scale);
        }
        Ok(())
    }
}

fn duration_ms(frame_count: u64, sample_rate: u32) -> u64 {
    if sample_rate == 0 {
        0
    } else {
        frame_count.saturating_mul(1000) / u64::from(sample_rate)
    }
}

fn chunk_count(frame_count: u64, sample_rate: u32, chunk_seconds: usize) -> usize {
    let chunk_frames = u64::from(sample_rate).saturating_mul(chunk_seconds as u64);
    if chunk_frames == 0 || frame_count == 0 {
        0
    } else {
        ((frame_count + chunk_frames - 1) / chunk_frames) as usize
    }
}

pub(crate) fn int_sample_scale(bits_per_sample: u16) -> f32 {
    (1u32 << bits_per_sample.saturating_sub(1)) as f32
}

fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frames);
    let channels_f = channels as f32;
    for frame in 0..frames {
        let start = frame * channels;
        let sum: f32 = interleaved[start..start + channels].iter().sum();
        mono.push(sum / channels_f);
    }
    mono
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::{WavSpec, WavWriter};
    use std::path::{Path, PathBuf};

    struct TempWav(PathBuf);

    impl TempWav {
        fn new(label: &str) -> Self {
            Self(std::env::temp_dir().join(format!(
                "open-clipper-wav-pcm-{label}-{}.wav",
                uuid::Uuid::new_v4()
            )))
        }
    }

    impl Drop for TempWav {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn write_pcm16_wav(
        path: &Path,
        sample_rate: u32,
        channels: u16,
        samples: impl IntoIterator<Item = i16>,
    ) {
        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };
        let mut writer = WavWriter::create(path, spec).expect("create wav");
        for sample in samples {
            writer.write_sample(sample).expect("write sample");
        }
        writer.finalize().expect("finalize wav");
    }

    #[test]
    fn duration_from_header_matches_written_length() {
        let wav = TempWav::new("duration");
        let sample_rate = 16_000u32;
        let frames = 16_000u32;
        write_pcm16_wav(
            &wav.0,
            sample_rate,
            1,
            std::iter::repeat(0i16).take(frames as usize),
        );

        let source = WavPcmSource::open(&wav.0).expect("open wav");
        assert_eq!(source.duration_ms(), 1000);
        assert_eq!(duration_ms(u64::from(frames), sample_rate), 1000);
    }

    #[test]
    fn thirty_second_windows_keep_a_short_tail() {
        assert_eq!(chunk_count(75 * 16_000, 16_000, 30), 3);

        let sample_rate = 1_000u32;
        let frames = 75u64 * u64::from(sample_rate);
        let wav = TempWav::new("chunks");
        write_pcm16_wav(
            &wav.0,
            sample_rate,
            1,
            std::iter::repeat(1000i16).take(frames as usize),
        );

        let mut source = WavPcmSource::open(&wav.0).expect("open wav");
        assert_eq!(source.chunk_count(30), 3);
        let chunk_frames = sample_rate as usize * 30;
        let first = source.next_mono_chunk(chunk_frames).unwrap().unwrap();
        let second = source.next_mono_chunk(chunk_frames).unwrap().unwrap();
        let tail = source.next_mono_chunk(chunk_frames).unwrap().unwrap();
        assert_eq!(first.len(), chunk_frames);
        assert_eq!(second.len(), chunk_frames);
        assert_eq!(tail.len(), 15 * sample_rate as usize);
        assert!(source.next_mono_chunk(chunk_frames).unwrap().is_none());
    }

    #[test]
    fn stereo_frames_are_averaged_to_mono() {
        let wav = TempWav::new("stereo");
        write_pcm16_wav(&wav.0, 8_000, 2, [16_384i16, 0, -16_384, -16_384]);

        let mut source = WavPcmSource::open(&wav.0).expect("open wav");
        assert_eq!(source.duration_ms(), 0);
        let samples = source.next_mono_chunk(8).unwrap().unwrap();
        assert_eq!(samples.len(), 2);
        assert!((samples[0] - 0.25).abs() < 1e-6);
        assert!((samples[1] + 0.5).abs() < 1e-6);
        assert!(source.next_mono_chunk(8).unwrap().is_none());
    }

    #[test]
    fn int16_samples_map_into_unit_float_range() {
        let wav = TempWav::new("int16");
        write_pcm16_wav(&wav.0, 8_000, 1, [i16::MAX, 0, i16::MIN]);

        let mut source = WavPcmSource::open(&wav.0).expect("open wav");
        let samples = source.next_mono_chunk(8).unwrap().unwrap();
        assert_eq!(samples.len(), 3);
        assert!((samples[0] - (i16::MAX as f32 / 32768.0)).abs() < 1e-6);
        assert!(samples[1].abs() < 1e-6);
        assert!((samples[2] - (i16::MIN as f32 / 32768.0)).abs() < 1e-6);
    }
}
