use super::parakeet_tokens::{
    extract_timestamped_tokens, group_words_into_segments, merge_sentencepiece_tokens,
};
use super::types::{
    ParakeetTranscriptionProgress, ParakeetTranscriptionResult, TranscriptionError,
};
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig, Wave};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

// The Parakeet encoder uses quadratic self-attention. Supplying a full video
// soundtrack can exceed its usable attention window and makes ONNX Runtime
// abort the process rather than returning an inference error. Keep every call
// well below that limit and stitch the timestamped results afterwards.
pub const MAX_DECODE_CHUNK_SECONDS: usize = 30;

pub struct ParakeetProvider {
    recognizer: OfflineRecognizer,
}

impl ParakeetProvider {
    pub fn load(model_dir: impl AsRef<Path>, num_threads: i32) -> Result<Self, TranscriptionError> {
        Self::load_with_provider(model_dir, "cpu", num_threads)
    }

    pub fn load_with_provider(
        model_dir: impl AsRef<Path>,
        provider: &str,
        num_threads: i32,
    ) -> Result<Self, TranscriptionError> {
        let model_dir = model_dir.as_ref();
        let mut config = OfflineRecognizerConfig::default();

        config.model_config.transducer = OfflineTransducerModelConfig {
            encoder: Some(required_model_path(model_dir, "encoder.int8.onnx")?),
            decoder: Some(required_model_path(model_dir, "decoder.int8.onnx")?),
            joiner: Some(required_model_path(model_dir, "joiner.int8.onnx")?),
        };
        config.model_config.tokens = Some(required_model_path(model_dir, "tokens.txt")?);
        config.model_config.model_type = Some("nemo_transducer".into());
        config.model_config.provider = Some(provider.to_string());
        config.model_config.num_threads = num_threads;
        config.model_config.debug = false;

        let recognizer = OfflineRecognizer::create(&config).ok_or_else(|| {
            TranscriptionError::ModelLoad(format!(
                "Nie udało się utworzyć OfflineRecognizer (provider={provider})"
            ))
        })?;

        Ok(Self { recognizer })
    }

    pub fn smoke_decode(&self, sample_rate: i32, samples: &[f32]) -> bool {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(sample_rate, samples);
        self.recognizer.decode(&stream);
        stream.get_result().is_some()
    }

    pub fn transcribe_wav(
        &self,
        audio_path: impl AsRef<Path>,
    ) -> Result<ParakeetTranscriptionResult, TranscriptionError> {
        self.transcribe_wav_with_progress::<fn(ParakeetTranscriptionProgress) -> Result<(), String>>(
            audio_path,
            None,
            None,
        )
    }

    pub fn transcribe_wav_with_progress<F>(
        &self,
        audio_path: impl AsRef<Path>,
        cancelled: Option<&AtomicBool>,
        mut on_progress: Option<&mut F>,
    ) -> Result<ParakeetTranscriptionResult, TranscriptionError>
    where
        F: FnMut(ParakeetTranscriptionProgress) -> Result<(), String>,
    {
        let started = Instant::now();
        let audio_path = audio_path.as_ref();
        let audio_path_str = audio_path.to_str().ok_or_else(|| {
            TranscriptionError::InvalidAudio("Nieprawidłowa ścieżka audio".into())
        })?;

        let wave = Wave::read(audio_path_str).ok_or_else(|| {
            TranscriptionError::InvalidAudio("Nie udało się odczytać audio".into())
        })?;

        let duration_ms = if wave.sample_rate() > 0 {
            wave.samples().len() as u64 * 1000 / wave.sample_rate() as u64
        } else {
            0
        };

        let sample_rate = wave.sample_rate();
        if sample_rate <= 0 {
            return Err(TranscriptionError::InvalidAudio(
                "Audio ma nieprawidłową częstotliwość próbkowania".into(),
            ));
        }

        let chunk_samples = (sample_rate as usize).saturating_mul(MAX_DECODE_CHUNK_SECONDS);
        if chunk_samples == 0 {
            return Err(TranscriptionError::InvalidAudio(
                "Nie można podzielić audio na fragmenty".into(),
            ));
        }

        let chunks: Vec<&[f32]> = wave.samples().chunks(chunk_samples).collect();
        let chunk_count = chunks.len().max(1);

        let mut text_parts = Vec::new();
        let mut words = Vec::new();
        for (chunk_index, samples) in chunks.into_iter().enumerate() {
            if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                return Err(TranscriptionError::Cancelled);
            }

            let stream = self.recognizer.create_stream();
            stream.accept_waveform(sample_rate, samples);
            self.recognizer.decode(&stream);

            let result = stream
                .get_result()
                .ok_or_else(|| TranscriptionError::Inference("Model nie zwrócił wyniku".into()))?;

            if !result.text.trim().is_empty() {
                text_parts.push(result.text.clone());
            }

            let offset_seconds = chunk_index * MAX_DECODE_CHUNK_SECONDS;
            let offset_seconds = offset_seconds as f64;
            words.extend(
                merge_sentencepiece_tokens(&extract_timestamped_tokens(&result))
                    .into_iter()
                    .map(|mut word| {
                        word.start_time += offset_seconds;
                        word.end_time += offset_seconds;
                        word
                    }),
            );

            if let Some(callback) = on_progress.as_deref_mut() {
                let completed = chunk_index + 1;
                callback(ParakeetTranscriptionProgress {
                    phase: "inferencing".into(),
                    chunk_index,
                    chunk_count,
                    ratio: completed as f64 / chunk_count as f64,
                })
                .map_err(TranscriptionError::Inference)?;
            }
        }

        let segments = group_words_into_segments(&words);
        let text = if text_parts.is_empty() {
            words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            text_parts.join(" ")
        };

        Ok(ParakeetTranscriptionResult {
            text,
            duration_ms,
            processing_time_ms: started.elapsed().as_millis() as u64,
            engine: "parakeet_local".to_string(),
            words,
            segments,
        })
    }
}

fn required_model_path(directory: &Path, filename: &str) -> Result<String, TranscriptionError> {
    let path: PathBuf = directory.join(filename);
    if !path.exists() {
        return Err(TranscriptionError::ModelNotInstalled);
    }
    path.to_str().map(str::to_owned).ok_or_else(|| {
        TranscriptionError::ModelLoad(format!("Nieprawidłowa ścieżka: {}", path.display()))
    })
}
