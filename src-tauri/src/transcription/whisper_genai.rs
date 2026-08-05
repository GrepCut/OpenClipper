//! Native Whisper runner backed by sherpa-onnx engine and DirectML/GPU.

use super::parakeet_tokens::{
    ensure_monotonic_word_ends, extract_timestamped_tokens_for_whisper,
    group_words_into_segments, merge_sentencepiece_tokens,
};
use super::types::{
    LocalTranscriptionProgress, ParakeetTranscriptionResult, TranscriptionError,
    TranscriptionWord, WhisperModelStatus,
};
use crate::infra::model_cache::download_model_file_to_cache;
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineRecognizerResult, OfflineWhisperModelConfig,
    Wave,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::Instant,
};
use tauri::{AppHandle, Manager};

const MODEL_DIR_NAME: &str = "whisper-large-v3-turbo-dml";
const MODEL_CDN_PREFIX: &str = "/models/whisper-large-v3-turbo-dml";
const REQUIRED_FILES: [&str; 4] = [
    "config.json",
    "decoder.int8.onnx",
    "encoder.int8.onnx",
    "tokens.txt",
];

// Whisper's encoder accepts a dynamic number of frames, but the decoder has a
// finite text context. Short, overlapping windows prevent a dense or long
// soundtrack from exhausting that context and make language identification run
// again after every boundary.
pub const WHISPER_CHUNK_SECONDS: f64 = 15.0;
pub const WHISPER_CHUNK_OVERLAP_SECONDS: f64 = 3.0;
/// Max |Δt| for treating identical normalized words as the same boundary duplicate.
const BOUNDARY_DEDUPE_SECONDS: f64 = 0.40;
/// Overlap merge: treat same normalized text within this window as one word.
const OVERLAP_DEDUPE_SECONDS: f64 = 0.75;
/// Mel bins for Whisper turbo / large-v3 (sherpa also reads this from the ONNX graph).
const WHISPER_FEATURE_DIM: i32 = 128;
/// Multilingual Whisper tail padding (samples after the last speech frame).
const WHISPER_TAIL_PADDINGS: i32 = 300;
/// Reject clips longer than this before loading the full WAV into memory.
pub const MAX_ASR_AUDIO_SECONDS: f64 = 900.0;
/// Dense decode loops (chars / second of covered span) trigger n-gram truncation.
const COMPRESSION_CHARS_PER_SEC: f64 = 60.0;


static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());

pub fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("models").join(MODEL_DIR_NAME))
        .map_err(|error| format!("Cannot resolve Whisper model directory: {error}"))
}

fn installed(path: &Path) -> bool {
    REQUIRED_FILES.iter().all(|file| path.join(file).is_file())
}

pub fn model_status(app: &AppHandle) -> Result<WhisperModelStatus, String> {
    let path = model_dir(app)?;
    let is_installed = installed(&path);
    Ok(WhisperModelStatus {
        installed: is_installed,
        loaded: false,
        path: is_installed.then(|| path.display().to_string()),
        provider: is_installed.then(|| "GPU (DirectML)".to_owned()),
    })
}

pub fn download_and_install_model(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = DOWNLOAD_LOCK
        .lock()
        .map_err(|_| "Whisper download lock poisoned".to_string())?;
    let path = model_dir(app)?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Nie udało się utworzyć katalogu Whisper: {error}"))?;

    for file in REQUIRED_FILES {
        let local = path.join(file);
        let remote = format!("{MODEL_CDN_PREFIX}/{file}");
        download_model_file_to_cache(app, &local, &remote)
            .map_err(|error| format!("Nie udało się pobrać Whisper {file}: {error}"))?;
    }

    if !installed(&path) {
        return Err("Po pobraniu brakuje wymaganych plików Whisper".to_string());
    }
    Ok(path)
}

pub fn delete_model(app: &AppHandle) -> Result<(), String> {
    let path = model_dir(app)?;
    if path.exists() {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("Nie udało się usunąć Whisper: {error}"))?;
    }
    Ok(())
}

fn required_model_path(directory: &Path, filename: &str) -> Result<String, TranscriptionError> {
    let path: PathBuf = directory.join(filename);
    if !path.exists() {
        return Err(TranscriptionError::ModelNotInstalled);
    }
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| TranscriptionError::ModelLoad(format!("Nieprawidłowa ścieżka: {}", path.display())))
}

pub fn transcribe(
    app: &AppHandle,
    audio_path: &str,
    language: Option<&str>,
) -> Result<ParakeetTranscriptionResult, String> {
    let model_dir = match model_dir(app) {
        Ok(d) => d,
        Err(e) => {
            return Err(e);
        }
    };
    transcribe_model_dir_with_progress::<fn(LocalTranscriptionProgress) -> Result<(), String>>(
        &model_dir,
        audio_path,
        language,
        None,
        None,
    )
}

pub fn transcribe_with_progress<F>(
    app: &AppHandle,
    audio_path: &str,
    language: Option<&str>,
    cancelled: Option<&AtomicBool>,
    on_progress: Option<&mut F>,
) -> Result<ParakeetTranscriptionResult, String>
where
    F: FnMut(LocalTranscriptionProgress) -> Result<(), String>,
{
    let model_dir = model_dir(app)?;
    transcribe_model_dir_with_progress(&model_dir, audio_path, language, cancelled, on_progress)
}

/// Shared production/smoke-test entry point. `None` or `Some("auto")` runs the
/// first chunks with Whisper language detection, then locks the detected code
/// for the rest of the file (FE override still wins when a concrete language is passed).
pub fn transcribe_model_dir(
    model_dir: &Path,
    audio_path: &str,
    language: Option<&str>,
) -> Result<ParakeetTranscriptionResult, String> {
    transcribe_model_dir_with_progress::<fn(LocalTranscriptionProgress) -> Result<(), String>>(
        model_dir,
        audio_path,
        language,
        None,
        None,
    )
}

fn transcribe_model_dir_with_progress<F>(
    model_dir: &Path,
    audio_path: &str,
    language: Option<&str>,
    cancelled: Option<&AtomicBool>,
    mut on_progress: Option<&mut F>,
) -> Result<ParakeetTranscriptionResult, String>
where
    F: FnMut(LocalTranscriptionProgress) -> Result<(), String>,
{
    let started = Instant::now();
    let target_language = language.filter(|s| !s.trim().is_empty() && *s != "auto");

    let audio_path_buf = PathBuf::from(audio_path);
    let audio_exists = audio_path_buf.is_file();

    if !installed(&model_dir) {
        return Err(TranscriptionError::ModelNotInstalled.to_string());
    }

    if !audio_exists {
        return Err(TranscriptionError::InvalidAudio("Plik WAV nie istnieje".into()).to_string());
    }

    let wave = match Wave::read(audio_path) {
        Some(w) => w,
        None => {
            return Err(TranscriptionError::InvalidAudio("Nie udało się odczytać pliku audio WAV".into()).to_string());
        }
    };

    let sample_rate = wave.sample_rate();
    let sample_count = wave.samples().len();
    if sample_rate <= 0 {
        return Err(TranscriptionError::InvalidAudio("Nieprawidłowy sample rate".into()).to_string());
    }
    if sample_count == 0 {
        return Err(TranscriptionError::InvalidAudio("Plik WAV nie zawiera próbek audio".into()).to_string());
    }

    let duration_ms = (sample_count as u64 * 1000) / sample_rate as u64;
    let duration_sec = duration_ms as f64 / 1000.0;
    if duration_sec > MAX_ASR_AUDIO_SECONDS {
        let err = format!(
            "Audio clip is too long for local Whisper ({duration_sec:.1}s). Maximum is {:.0}s.",
            MAX_ASR_AUDIO_SECONDS
        );
        return Err(TranscriptionError::InvalidAudio(err).to_string());
    }

    let encoder_path = match required_model_path(&model_dir, "encoder.int8.onnx") {
        Ok(p) => p,
        Err(e) => {
            return Err(e.to_string());
        }
    };
    let decoder_path = match required_model_path(&model_dir, "decoder.int8.onnx") {
        Ok(p) => p,
        Err(e) => {
            return Err(e.to_string());
        }
    };

    let tokens_path = match required_model_path(&model_dir, "tokens.txt") {
        Ok(p) => p,
        Err(e) => {
            return Err(e.to_string());
        }
    };

    let build_config = |provider: &str, language: Option<&str>| {
        let mut config = OfflineRecognizerConfig::default();
        config.feat_config.feature_dim = WHISPER_FEATURE_DIM;
        config.model_config.whisper = OfflineWhisperModelConfig {
            encoder: Some(encoder_path.clone()),
            decoder: Some(decoder_path.clone()),
            language: language.map(|s| s.to_string()),
            task: Some("transcribe".to_string()),
            tail_paddings: WHISPER_TAIL_PADDINGS,
            enable_token_timestamps: true,
            // Segment timestamp rules in sherpa's greedy loop encourage timing loops on music.
            enable_segment_timestamps: false,
        };
        config.model_config.tokens = Some(tokens_path.clone());
        config.model_config.provider = Some(provider.to_string());
        config.model_config.num_threads = 4;
        config.model_config.debug = false;
        config
    };

    let create_recognizer = |provider: &str, language: Option<&str>| -> Result<(OfflineRecognizer, &'static str), String> {
        let preferred = if provider == "cpu" { "cpu" } else { "directml" };

        let _create_start = Instant::now();
        if preferred == "directml" {
            let recognizer_result = std::panic::catch_unwind(|| {
                let config = build_config("directml", language);
                OfflineRecognizer::create(&config)
            });
            match recognizer_result {
                Ok(Some(rec)) => {
                    return Ok((rec, "directml"));
                }
                Ok(None) => {}
                Err(_) => {}
            }
        }

        let _cpu_start = Instant::now();
        let cpu_res = std::panic::catch_unwind(|| {
            let config = build_config("cpu", language);
            OfflineRecognizer::create(&config)
        });
        match cpu_res {
            Ok(Some(rec)) => Ok((rec, "cpu")),
            _ => {
                Err("Nie udało się utworzyć silnika sherpa-onnx Whisper (zarówno DirectML jak i CPU fallback).".to_string())
            }
        }
    };

    let (mut recognizer, mut active_provider) = create_recognizer("directml", target_language)?;
    let mut locked_language: Option<String> = target_language.map(|s| s.to_string());
    let mut language_candidates: Vec<(String, usize)> = Vec::new();

    let _decode_start = Instant::now();
    let total_audio_sec = (duration_ms as f64 / 1000.0).max(0.1);
    let chunks = whisper_chunks(sample_count, sample_rate);
    let chunk_count = chunks.len();
    let mut words = Vec::new();

    for (chunk_index, chunk) in chunks.iter().enumerate() {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            return Err(TranscriptionError::Cancelled.to_string());
        }

        let samples = &wave.samples()[chunk.start_sample..chunk.end_sample];
        let decode_result = std::panic::catch_unwind(|| {
            let stream = recognizer.create_stream();
            stream.accept_waveform(sample_rate, samples);
            recognizer.decode(&stream);
            stream.get_result()
        });

        let result = match decode_result {
            Ok(Some(result)) => result,
            Ok(None) => {
                let err = format!("Model Whisper nie zwrócił wyniku dla fragmentu {}/{}", chunk_index + 1, chunk_count);
                return Err(err);
            }
            Err(panic_err) => {
                let panic_msg = format!("Panic during Whisper decode for chunk {}/{}: {:?}", chunk_index + 1, chunk_count, panic_err);
                return Err(panic_msg);
            }
        };

        // Auto mode: sample language from the first two chunks (weighted by word count),
        // then recreate once so the rest of the file stays on one language.
        if locked_language.is_none() {
            if let Some(detected) = detect_language_from_result(&result) {
                let weight = result.text.split_whitespace().count().max(1);
                language_candidates.push((detected, weight));
            }
            let should_lock = chunk_index >= 1 || chunk_index + 1 >= chunk_count;
            if should_lock {
                let best = if language_candidates.len() >= 2
                    && language_candidates.first().map(|(lang, _)| lang.as_str())
                        != language_candidates.last().map(|(lang, _)| lang.as_str())
                {
                    // Intro music/hallucination often poisons chunk 0 LID; prefer the later sample.
                    language_candidates.last().cloned()
                } else {
                    language_candidates
                        .iter()
                        .max_by_key(|(_, weight)| *weight)
                        .cloned()
                };
                if let Some((best_lang, _best_weight)) = best {
                    locked_language = Some(best_lang.clone());
                    if chunk_index + 1 < chunk_count {
                        if let Ok((rec, provider)) =
                            create_recognizer(active_provider, Some(best_lang.as_str()))
                        {
                            recognizer = rec;
                            active_provider = provider;
                        }
                    }
                }
            }
        }

        let (mut chunk_words, _timing_source) =
            words_from_chunk(&result, chunk.duration_seconds(sample_rate));
        for word in &mut chunk_words {
            word.start_time = (word.start_time + chunk.start_seconds(sample_rate)).clamp(0.0, total_audio_sec);
            word.end_time = (word.end_time + chunk.start_seconds(sample_rate)).clamp(word.start_time, total_audio_sec);
        }
        sanitize_chunk_words(&mut chunk_words);

        merge_chunk_words(
            &mut words,
            &chunk_words,
            chunk,
            sample_rate,
            total_audio_sec,
            chunk_index == 0,
        );

        if let Some(callback) = on_progress.as_deref_mut() {
            callback(LocalTranscriptionProgress {
                phase: "inferencing".into(),
                chunk_index,
                chunk_count,
                ratio: (chunk_index + 1) as f64 / chunk_count.max(1) as f64,
                provider: Some(active_provider.into()),
            })
            .map_err(TranscriptionError::Inference)
            .map_err(|error| error.to_string())?;
        }
    }

    deduplicate_boundary_words(&mut words);
    sanitize_chunk_words(&mut words);
    let segments = group_words_into_segments(&words);
    let text = words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>().join(" ");

    let processing_time_ms = started.elapsed().as_millis() as u64;

    Ok(ParakeetTranscriptionResult {
        text,
        duration_ms,
        processing_time_ms,
        engine: "whisper_local".into(),
        provider: active_provider.into(),
        words,
        segments,
    })
}

#[derive(Debug, Clone, Copy)]
struct WhisperChunk {
    start_sample: usize,
    end_sample: usize,
}

impl WhisperChunk {
    fn start_seconds(self, sample_rate: i32) -> f64 {
        self.start_sample as f64 / sample_rate as f64
    }

    fn end_seconds(self, sample_rate: i32) -> f64 {
        self.end_sample as f64 / sample_rate as f64
    }

    fn duration_seconds(self, sample_rate: i32) -> f64 {
        self.end_seconds(sample_rate) - self.start_seconds(sample_rate)
    }

    fn exclusive_range(self, sample_rate: i32, total_audio_sec: f64) -> (f64, f64) {
        // Ownership splits at the midpoint of the audio overlap window.
        let overlap_half = WHISPER_CHUNK_OVERLAP_SECONDS / 2.0;
        let owner_start = if self.start_sample == 0 {
            0.0
        } else {
            self.start_seconds(sample_rate) + overlap_half
        };
        let owner_end = if (self.end_seconds(sample_rate) - total_audio_sec).abs() < 0.000_1 {
            total_audio_sec
        } else {
            self.end_seconds(sample_rate) - overlap_half
        };
        (owner_start, owner_end.max(owner_start))
    }

    fn in_overlap_zone(self, word: &TranscriptionWord, sample_rate: i32, total_audio_sec: f64) -> bool {
        let midpoint = (word.start_time + word.end_time) / 2.0;
        let (exclusive_start, exclusive_end) = self.exclusive_range(sample_rate, total_audio_sec);
        let chunk_start = self.start_seconds(sample_rate);
        let chunk_end = self.end_seconds(sample_rate);
        (midpoint >= chunk_start && midpoint < exclusive_start)
            || (midpoint > exclusive_end && midpoint <= chunk_end)
    }

    fn owns_word(self, word: &TranscriptionWord, sample_rate: i32, total_audio_sec: f64) -> bool {
        let midpoint = (word.start_time + word.end_time) / 2.0;
        let (owner_start, owner_end) = self.exclusive_range(sample_rate, total_audio_sec);
        midpoint >= owner_start && midpoint <= owner_end
    }
}

/// Prefer longer surface form / longer span when two candidates describe the same speech.
fn word_quality(word: &TranscriptionWord) -> (usize, f64) {
    (
        normalized_word(&word.text).chars().count(),
        (word.end_time - word.start_time).max(0.0),
    )
}

fn words_near_duplicate(left: &TranscriptionWord, right: &TranscriptionWord, max_delta: f64) -> bool {
    let left_norm = normalized_word(&left.text);
    let right_norm = normalized_word(&right.text);
    !left_norm.is_empty()
        && left_norm == right_norm
        && (left.start_time - right.start_time).abs() <= max_delta
}

fn normalized_trigram_at(words: &[TranscriptionWord], index: usize) -> Option<String> {
    if index + 2 >= words.len() {
        return None;
    }
    let a = normalized_word(&words[index].text);
    let b = normalized_word(&words[index + 1].text);
    let c = normalized_word(&words[index + 2].text);
    if a.is_empty() || b.is_empty() || c.is_empty() {
        return None;
    }
    Some(format!("{a} {b} {c}"))
}

fn overlap_has_near_match(accumulated: &[TranscriptionWord], word: &TranscriptionWord) -> bool {
    accumulated.iter().rev().take(96).any(|previous| {
        words_near_duplicate(previous, word, OVERLAP_DEDUPE_SECONDS)
    })
}

fn overlap_has_matching_trigram(
    accumulated: &[TranscriptionWord],
    chunk_words: &[TranscriptionWord],
    chunk_index: usize,
) -> bool {
    let Some(incoming) = normalized_trigram_at(chunk_words, chunk_index) else {
        return false;
    };
    let start_time = chunk_words[chunk_index].start_time;
    for i in accumulated.len().saturating_sub(96)..accumulated.len().saturating_sub(2) {
        let Some(existing) = normalized_trigram_at(accumulated, i) else {
            continue;
        };
        if existing == incoming
            && (accumulated[i].start_time - start_time).abs() <= OVERLAP_DEDUPE_SECONDS * 2.0
        {
            return true;
        }
    }
    false
}

/// Merge words from one chunk into the transcript.
/// Exclusive zone: keep this chunk's words. Overlap: only fill gaps (no aggressive union).
fn merge_chunk_words(
    accumulated: &mut Vec<TranscriptionWord>,
    chunk_words: &[TranscriptionWord],
    chunk: &WhisperChunk,
    sample_rate: i32,
    total_audio_sec: f64,
    is_first_chunk: bool,
) {
    if is_first_chunk {
        accumulated.extend(chunk_words.iter().cloned());
        return;
    }

    for (index, word) in chunk_words.iter().enumerate() {
        if chunk.owns_word(word, sample_rate, total_audio_sec) {
            if let Some(existing) = accumulated
                .iter_mut()
                .rev()
                .take(48)
                .find(|previous| words_near_duplicate(previous, word, BOUNDARY_DEDUPE_SECONDS * 2.0))
            {
                if word_quality(word) > word_quality(existing) {
                    *existing = word.clone();
                }
                continue;
            }
            accumulated.push(word.clone());
            continue;
        }

        if !chunk.in_overlap_zone(word, sample_rate, total_audio_sec) {
            continue;
        }

        // Overlap: keep only if this speech is missing from the previous chunk's contribution.
        if overlap_has_near_match(accumulated, word) {
            continue;
        }
        if overlap_has_matching_trigram(accumulated, chunk_words, index) {
            continue;
        }
        accumulated.push(word.clone());
    }
}

fn is_caption_hallucination(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();

    if lower.starts_with('*') && lower.ends_with('*') && lower.len() >= 3 {
        let inner = &lower[1..lower.len() - 1];
        if inner.contains("music")
            || inner.contains("applause")
            || inner.contains("laughter")
            || inner.contains("silence")
            || inner.contains("planetro")
            || inner.contains("blank")
        {
            return true;
        }
    }

    let bracket_inner = lower
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .or_else(|| lower.strip_prefix('(').and_then(|value| value.strip_suffix(')')));
    if let Some(inner) = bracket_inner {
        let inner = inner.trim();
        return matches!(
            inner,
            "music" | "applause" | "laughter" | "silence" | "inaudible" | "blank_audio"
        ) || inner.contains("music");
    }

    // Split tokens like "*Planetro" / "music*" that lost their pair.
    if (lower.contains("music") || lower.contains("planetro"))
        && (lower.contains('*') || lower.contains('[') || lower.contains(']'))
    {
        return true;
    }

    false
}

fn strip_caption_hallucinations(words: &mut Vec<TranscriptionWord>) {
    words.retain(|word| !is_caption_hallucination(&word.text));
}

fn collapse_repeated_ngrams(words: &mut Vec<TranscriptionWord>) {
    if words.len() < 6 {
        return;
    }

    let norms: Vec<String> = words.iter().map(|word| normalized_word(&word.text)).collect();
    let mut kept: Vec<TranscriptionWord> = Vec::with_capacity(words.len());
    let mut index = 0;

    while index < words.len() {
        let mut collapsed = false;
        for n in (2..=5).rev() {
            if index + n * 3 > words.len() {
                continue;
            }
            let pattern = &norms[index..index + n];
            if pattern.iter().any(|token| token.is_empty()) {
                continue;
            }

            let mut repeats = 1;
            let mut cursor = index + n;
            while cursor + n <= words.len() && norms[cursor..cursor + n] == *pattern {
                repeats += 1;
                cursor += n;
            }

            if repeats >= 3 {
                kept.extend(words[index..index + n].iter().cloned());
                index = cursor;
                collapsed = true;
                break;
            }
        }

        if !collapsed {
            kept.push(words[index].clone());
            index += 1;
        }
    }

    *words = kept;
}

fn find_first_ngram_loop_start(words: &[TranscriptionWord]) -> Option<usize> {
    let norms: Vec<String> = words.iter().map(|word| normalized_word(&word.text)).collect();
    for index in 0..words.len() {
        for n in 2..=5 {
            if index + n * 3 > words.len() {
                continue;
            }
            let pattern = &norms[index..index + n];
            if pattern.iter().any(|token| token.is_empty()) {
                continue;
            }
            let mut repeats = 1;
            let mut cursor = index + n;
            while cursor + n <= words.len() && norms[cursor..cursor + n] == *pattern {
                repeats += 1;
                cursor += n;
            }
            if repeats >= 3 {
                return Some(index);
            }
        }
    }
    None
}

fn apply_compression_guard(words: &mut Vec<TranscriptionWord>) {
    if words.len() < 8 {
        return;
    }
    let start = words.first().map(|word| word.start_time).unwrap_or(0.0);
    let end = words
        .last()
        .map(|word| word.end_time.max(word.start_time))
        .unwrap_or(start);
    let duration = (end - start).max(0.5);
    let chars: usize = words.iter().map(|word| word.text.chars().count()).sum();
    let density = chars as f64 / duration;
    if density <= COMPRESSION_CHARS_PER_SEC {
        return;
    }
    if let Some(loop_start) = find_first_ngram_loop_start(words) {
        // Keep one copy of the looping phrase, drop the dense repeated tail.
        let mut keep_end = loop_start + 1;
        for n in 2..=5 {
            if loop_start + n <= words.len() {
                let pattern: Vec<_> = words[loop_start..loop_start + n]
                    .iter()
                    .map(|word| normalized_word(&word.text))
                    .collect();
                if pattern.iter().any(|token| token.is_empty()) {
                    continue;
                }
                if loop_start + n * 2 <= words.len() {
                    let next: Vec<_> = words[loop_start + n..loop_start + 2 * n]
                        .iter()
                        .map(|word| normalized_word(&word.text))
                        .collect();
                    if next == pattern {
                        keep_end = loop_start + n;
                        break;
                    }
                }
            }
        }
        words.truncate(keep_end.max(1));
    }
}

/// Strip caption tags, collapse decoder n-gram loops, and trim hyper-dense tails.
fn sanitize_chunk_words(words: &mut Vec<TranscriptionWord>) {
    strip_caption_hallucinations(words);
    collapse_repeated_ngrams(words);
    apply_compression_guard(words);
    // Compression truncate may leave a shorter loop; collapse again.
    collapse_repeated_ngrams(words);
    strip_caption_hallucinations(words);
}

fn detect_language_from_result(result: &OfflineRecognizerResult) -> Option<String> {
    let from_field = result.lang.trim().to_ascii_lowercase();
    if (2..=3).contains(&from_field.len()) && from_field.chars().all(|c| c.is_ascii_alphabetic()) {
        return Some(from_field);
    }
    detect_language_from_tokens(&result.tokens)
}

fn detect_language_from_tokens(tokens: &[String]) -> Option<String> {
    const SKIP: &[&str] = &[
        "startoftranscript",
        "endoftranscript",
        "startoflm",
        "startofprev",
        "nospeech",
        "notimestamps",
        "transcribe",
        "translate",
    ];
    for token in tokens {
        let Some(stripped) = token
            .trim()
            .strip_prefix("<|")
            .and_then(|value| value.strip_suffix("|>"))
        else {
            continue;
        };
        let inner = stripped.to_ascii_lowercase();
        if SKIP.contains(&inner.as_str()) {
            continue;
        }
        if inner.parse::<f64>().is_ok() {
            continue;
        }
        if (2..=3).contains(&inner.len()) && inner.chars().all(|c| c.is_ascii_alphabetic()) {
            return Some(inner);
        }
    }
    None
}

fn whisper_chunks(sample_count: usize, sample_rate: i32) -> Vec<WhisperChunk> {
    let window_samples = (WHISPER_CHUNK_SECONDS * sample_rate as f64).round() as usize;
    let overlap_samples = (WHISPER_CHUNK_OVERLAP_SECONDS * sample_rate as f64).round() as usize;
    let stride_samples = window_samples.saturating_sub(overlap_samples);
    if sample_count == 0 || window_samples == 0 || stride_samples == 0 {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < sample_count {
        let end = (start + window_samples).min(sample_count);
        chunks.push(WhisperChunk { start_sample: start, end_sample: end });
        if end == sample_count {
            break;
        }
        start += stride_samples;
    }
    chunks
}

fn has_distinct_starts(words: &[TranscriptionWord]) -> bool {
    if words.len() < 2 {
        return words.iter().any(|w| w.start_time > 0.001 || w.end_time > w.start_time);
    }
    let first = words[0].start_time;
    words.iter().any(|w| (w.start_time - first).abs() > 0.001)
}

fn words_from_chunk(
    result: &OfflineRecognizerResult,
    chunk_duration_sec: f64,
) -> (Vec<TranscriptionWord>, &'static str) {
    let float_ok = result
        .durations
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .any(|&d| d > 0.001);
    let timing_source = if float_ok { "float" } else { "phrase" };

    let mut words = merge_sentencepiece_tokens(&extract_timestamped_tokens_for_whisper(result));
    ensure_monotonic_word_ends(&mut words);

    // Keep phrase/DTW starts even when durations were tiny — never wipe them for full-chunk even-space.
    if !words.is_empty() && has_distinct_starts(&words) {
        return (words, timing_source);
    }
    if !words.is_empty() {
        return (words, timing_source);
    }

    let raw_words: Vec<&str> = result.text.split_whitespace().collect();
    if raw_words.is_empty() {
        return (Vec::new(), "even_chunk");
    }

    // Last resort: spread across the speech span hinted by any residual word times, else full chunk.
    let span_start = 0.0;
    let span_end = chunk_duration_sec.max(0.1);
    let seconds_per_word = (span_end - span_start) / raw_words.len() as f64;
    let words = raw_words
        .into_iter()
        .enumerate()
        .map(|(index, text)| TranscriptionWord {
            text: text.to_string(),
            start_time: span_start + index as f64 * seconds_per_word,
            end_time: span_start + (index + 1) as f64 * seconds_per_word,
        })
        .collect();
    (words, "even_chunk")
}

fn normalized_word(text: &str) -> String {
    text
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase()
}

fn deduplicate_boundary_words(words: &mut Vec<TranscriptionWord>) {
    words.sort_by(|left, right| left.start_time.total_cmp(&right.start_time));
    let mut deduplicated: Vec<TranscriptionWord> = Vec::with_capacity(words.len());
    for word in words.drain(..) {
        let duplicate = deduplicated.last().is_some_and(|previous| {
            words_near_duplicate(previous, &word, BOUNDARY_DEDUPE_SECONDS)
        });
        if !duplicate {
            deduplicated.push(word);
        }
    }
    *words = deduplicated;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, start: f64, end: f64) -> TranscriptionWord {
        TranscriptionWord {
            text: text.into(),
            start_time: start,
            end_time: end,
        }
    }

    #[test]
    fn chunks_cover_the_complete_audio_with_overlap() {
        // 15s window, 3s overlap → 12s stride.
        let chunks = whisper_chunks(61 * 16_000, 16_000);
        assert_eq!(chunks.len(), 5);
        assert_eq!((chunks[0].start_sample, chunks[0].end_sample), (0, 240_000));
        assert_eq!((chunks[1].start_sample, chunks[1].end_sample), (192_000, 432_000));
        assert_eq!((chunks[4].start_sample, chunks[4].end_sample), (768_000, 976_000));
    }

    #[test]
    fn deduplicates_only_identical_nearby_boundary_words() {
        let mut words = vec![
            word("ciao", 18.95, 19.10),
            word("Ciao,", 19.05, 19.20),
            word("mundo", 19.25, 19.45),
        ];
        deduplicate_boundary_words(&mut words);
        assert_eq!(words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), vec!["ciao", "mundo"]);
    }

    #[test]
    fn dedupe_keeps_same_word_when_times_differ_more_than_threshold() {
        let mut words = vec![
            word("hola", 10.0, 10.2),
            word("Hola", 10.50, 10.7),
        ];
        deduplicate_boundary_words(&mut words);
        assert_eq!(words.len(), 2);
    }

    #[test]
    fn overlap_merge_keeps_word_only_in_left_or_right_chunk() {
        let sample_rate = 16_000;
        let total_audio_sec = 36.0;
        let chunk = WhisperChunk {
            start_sample: 16 * sample_rate as usize,
            end_sample: 36 * sample_rate as usize,
        };

        let mut words = vec![
            word("only_left", 17.5, 17.8),
            word("shared", 18.0, 18.3),
            word("exclusive_prev", 12.0, 12.3),
        ];

        let right = vec![
            word("shared", 18.05, 18.4),
            word("only_right", 18.6, 18.9),
            word("later", 22.0, 22.3),
        ];

        merge_chunk_words(&mut words, &right, &chunk, sample_rate, total_audio_sec, false);
        deduplicate_boundary_words(&mut words);

        let texts: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        assert!(texts.contains(&"only_left"));
        assert!(texts.contains(&"only_right"));
        assert!(texts.contains(&"later"));
        assert!(texts.contains(&"exclusive_prev"));
        assert_eq!(texts.iter().filter(|t| **t == "shared").count(), 1);
    }

    #[test]
    fn overlap_merge_does_not_duplicate_phrase_half_second_apart() {
        let sample_rate = 16_000;
        let total_audio_sec = 30.0;
        // 15s chunk starting at 12s → overlap at leading edge ~12..13.5s.
        let chunk = WhisperChunk {
            start_sample: 12 * sample_rate as usize,
            end_sample: 27 * sample_rate as usize,
        };

        let mut words = vec![
            word("I", 12.4, 12.5),
            word("heard", 12.5, 12.7),
            word("you", 12.7, 12.9),
        ];
        let right = vec![
            word("I", 12.9, 13.0),
            word("heard", 13.0, 13.2),
            word("you", 13.2, 13.4),
            word("calling", 14.0, 14.3),
        ];

        merge_chunk_words(&mut words, &right, &chunk, sample_rate, total_audio_sec, false);
        sanitize_chunk_words(&mut words);
        deduplicate_boundary_words(&mut words);

        let texts: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts.iter().filter(|t| **t == "I").count(), 1);
        assert_eq!(texts.iter().filter(|t| **t == "heard").count(), 1);
        assert!(texts.contains(&"calling"));
    }

    #[test]
    fn sanitize_collapses_heard_you_calling_loop() {
        let mut words = Vec::new();
        for i in 0..10 {
            let base = i as f64 * 0.6;
            words.push(word("I", base, base + 0.15));
            words.push(word("heard", base + 0.15, base + 0.3));
            words.push(word("you", base + 0.3, base + 0.45));
            words.push(word("calling", base + 0.45, base + 0.6));
        }
        sanitize_chunk_words(&mut words);
        let texts: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, vec!["I", "heard", "you", "calling"]);
    }

    #[test]
    fn sanitize_strips_music_caption_tags() {
        let mut words = vec![
            word("*Planetro music*", 0.0, 0.5),
            word("*music*", 0.5, 0.8),
            word("You're", 1.0, 1.2),
            word("welcome", 1.2, 1.5),
            word("[music]", 1.5, 1.7),
            word("music*", 1.7, 1.9),
        ];
        sanitize_chunk_words(&mut words);
        let texts: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, vec!["You're", "welcome"]);
    }

    #[test]
    fn detects_language_from_result_lang_field() {
        let result = OfflineRecognizerResult {
            text: "cześć".into(),
            tokens: vec!["cześć".into()],
            timestamps: None,
            durations: None,
            lang: "pl".into(),
        };
        assert_eq!(detect_language_from_result(&result).as_deref(), Some("pl"));
    }

    #[test]
    fn detects_language_token_from_whisper_prefix() {
        let tokens = vec![
            "<|startoftranscript|>".into(),
            "<|es|>".into(),
            "<|transcribe|>".into(),
            "<|0.00|>".into(),
            " hola".into(),
        ];
        assert_eq!(detect_language_from_tokens(&tokens).as_deref(), Some("es"));
    }

    #[test]
    fn words_from_chunk_keeps_distinct_near_zero_duration_starts() {
        let tokens = vec![
            "<|0.00|>".to_string(),
            " hello".to_string(),
            " world".to_string(),
            "<|2.00|>".to_string(),
        ];
        let stamped = crate::transcription::parakeet_tokens::extract_from_whisper_timestamp_tokens(&tokens);
        let mut words = merge_sentencepiece_tokens(&stamped);
        for word in &mut words {
            word.end_time = word.start_time;
        }
        ensure_monotonic_word_ends(&mut words);
        assert!(has_distinct_starts(&words));
        assert!(words[0].start_time < words[1].start_time);
    }
}
