use super::types::{TranscriptionSegment, TranscriptionWord};
use sherpa_onnx::OfflineRecognizerResult;

const SENTENCEPIECE_SPACE: char = '\u{2581}';
const BYTE_BPE_SPACE: char = 'Ġ'; // \u{0120} used in Whisper BPE tokenizer
const SILENCE_GAP_SEC: f64 = 0.8;
const MIN_WORD_DURATION_SEC: f64 = 0.02;
const FLOAT_TS_EPS: f32 = 0.001;

#[derive(Debug, Clone, PartialEq)]
pub struct TimestampedToken {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// Prefer float DTW timestamps when starts and durations (or next-start ends) are usable.
/// Otherwise fall back to Whisper phrase `<|t|>` markers.
pub fn extract_timestamped_tokens(result: &OfflineRecognizerResult) -> Vec<TimestampedToken> {
    if let Some(tokens) = try_extract_float_timestamped_tokens(result) {
        return tokens;
    }
    extract_from_whisper_timestamp_tokens(&result.tokens)
}

/// Whisper path: use float DTW when durations are present; otherwise phrase markers.
pub fn extract_timestamped_tokens_for_whisper(
    result: &OfflineRecognizerResult,
) -> Vec<TimestampedToken> {
    if floats_have_usable_durations(result) {
        if let Some(floats) = try_extract_float_timestamped_tokens(result) {
            return floats;
        }
    }
    let phrase = extract_from_whisper_timestamp_tokens(&result.tokens);
    if !phrase.is_empty() {
        return phrase;
    }
    try_extract_float_timestamped_tokens(result).unwrap_or_default()
}

fn floats_have_usable_durations(result: &OfflineRecognizerResult) -> bool {
    let durations = result.durations.as_deref().unwrap_or(&[]);
    durations.iter().any(|&d| d > FLOAT_TS_EPS)
}

fn try_extract_float_timestamped_tokens(
    result: &OfflineRecognizerResult,
) -> Option<Vec<TimestampedToken>> {
    let timestamps = result.timestamps.as_deref().unwrap_or(&[]);
    let durations = result.durations.as_deref().unwrap_or(&[]);

    let has_valid_starts = !timestamps.is_empty() && timestamps.iter().any(|&ts| ts > FLOAT_TS_EPS);
    if !has_valid_starts {
        return None;
    }

    let has_durations = durations.iter().any(|&d| d > FLOAT_TS_EPS);
    let can_infer_ends = timestamps
        .windows(2)
        .any(|w| (w[1] - w[0]) > FLOAT_TS_EPS);
    if !has_durations && !can_infer_ends {
        return None;
    }

    let mut out = Vec::new();
    for (index, token) in result.tokens.iter().enumerate() {
        let trimmed = token.trim();
        if trimmed.starts_with("<|") && trimmed.ends_with("|>") {
            continue;
        }
        let start = timestamps.get(index).copied().unwrap_or_default() as f64;
        let duration = durations.get(index).copied().unwrap_or_default() as f64;
        let end = if duration > FLOAT_TS_EPS as f64 {
            start + duration
        } else if let Some(&next) = timestamps.get(index + 1) {
            let next = next as f64;
            if next > start + FLOAT_TS_EPS as f64 {
                next
            } else {
                start + MIN_WORD_DURATION_SEC
            }
        } else {
            start + MIN_WORD_DURATION_SEC
        };
        out.push(TimestampedToken {
            text: token.clone(),
            start_ms: (start * 1000.0).round() as u64,
            end_ms: ((end * 1000.0).round() as u64).max((start * 1000.0).round() as u64 + 1),
        });
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn parse_timestamp_token(token: &str) -> Option<f64> {
    let trimmed = token.trim();
    if trimmed.starts_with("<|") && trimmed.ends_with("|>") {
        let inner = &trimmed[2..trimmed.len() - 2];
        inner.parse::<f64>().ok()
    } else {
        None
    }
}

fn collect_whisper_phrases(tokens: &[String]) -> Vec<(f64, f64, Vec<String>)> {
    let mut phrases: Vec<(f64, f64, Vec<String>)> = Vec::new();
    let mut current_start_sec: Option<f64> = None;
    let mut current_tokens: Vec<String> = Vec::new();

    for token in tokens {
        let trimmed = token.trim();
        if let Some(ts) = parse_timestamp_token(trimmed) {
            if !current_tokens.is_empty() {
                let start = current_start_sec.unwrap_or(0.0);
                let end = if ts > start { ts } else { start + 2.0 };
                phrases.push((start, end, std::mem::take(&mut current_tokens)));
                current_start_sec = Some(ts);
            } else {
                current_start_sec = Some(ts);
            }
            continue;
        }
        if trimmed.starts_with("<|") && trimmed.ends_with("|>") {
            continue;
        }
        current_tokens.push(token.clone());
    }

    if !current_tokens.is_empty() {
        let start = current_start_sec.unwrap_or(0.0);
        let end = start + (current_tokens.len() as f64 * 0.4).max(1.0);
        phrases.push((start, end, current_tokens));
    }

    phrases
}

fn merge_phrase_tokens_to_words(phrase_tokens: &[String]) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();

    for token in phrase_tokens {
        let piece = normalize_token_text(token);
        if piece.is_empty() {
            continue;
        }
        if !current.is_empty() && is_word_start(token) {
            words.push(std::mem::take(&mut current));
        }
        current.push_str(&piece);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// Parse Whisper `<|t|>` phrase markers and distribute time across words by character weight.
pub fn extract_from_whisper_timestamp_tokens(tokens: &[String]) -> Vec<TimestampedToken> {
    let phrases = collect_whisper_phrases(tokens);
    let mut result = Vec::new();

    for (start_sec, end_sec, phrase_tokens) in phrases {
        let words = merge_phrase_tokens_to_words(&phrase_tokens);
        if words.is_empty() {
            continue;
        }
        let duration = (end_sec - start_sec).max(0.05);
        let total_chars: f64 = words.iter().map(|w| w.chars().count().max(1) as f64).sum();
        let mut cursor = start_sec;
        let last = words.len() - 1;
        for (index, text) in words.into_iter().enumerate() {
            let weight = text.chars().count().max(1) as f64 / total_chars;
            let token_start = cursor;
            let token_end = if index == last {
                start_sec + duration
            } else {
                (token_start + duration * weight).min(start_sec + duration)
            };
            // Leading space so merge_sentencepiece_tokens treats each as a new word.
            result.push(TimestampedToken {
                text: format!(" {text}"),
                start_ms: (token_start * 1000.0).round() as u64,
                end_ms: (token_end * 1000.0).round() as u64,
            });
            cursor = token_end;
        }
    }

    result
}

fn is_word_start(token: &str) -> bool {
    token.starts_with(SENTENCEPIECE_SPACE)
        || token.starts_with(' ')
        || token.starts_with(BYTE_BPE_SPACE)
}

fn normalize_token_text(token: &str) -> String {
    token
        .trim_start_matches(SENTENCEPIECE_SPACE)
        .trim_start_matches(' ')
        .trim_start_matches(BYTE_BPE_SPACE)
        .to_string()
}

/// Scal tokeny SentencePiece w słowa z timestampami.
pub fn merge_sentencepiece_tokens(tokens: &[TimestampedToken]) -> Vec<TranscriptionWord> {
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut words: Vec<TranscriptionWord> = Vec::new();
    let mut current_text = String::new();
    let mut current_start_ms = tokens[0].start_ms;
    let mut current_end_ms = tokens[0].end_ms;

    for token in tokens {
        let piece = normalize_token_text(&token.text);
        if piece.is_empty() {
            current_end_ms = current_end_ms.max(token.end_ms);
            continue;
        }

        let starts_new_word =
            words.is_empty() || current_text.is_empty() || is_word_start(&token.text);

        if starts_new_word && !current_text.is_empty() {
            words.push(TranscriptionWord {
                text: current_text.trim().to_string(),
                start_time: current_start_ms as f64 / 1000.0,
                end_time: current_end_ms as f64 / 1000.0,
            });
            current_text.clear();
            current_start_ms = token.start_ms;
        } else if current_text.is_empty() {
            current_start_ms = token.start_ms;
        }

        current_text.push_str(&piece);
        current_end_ms = token.end_ms.max(current_end_ms);
    }

    if !current_text.is_empty() {
        words.push(TranscriptionWord {
            text: current_text.trim().to_string(),
            start_time: current_start_ms as f64 / 1000.0,
            end_time: current_end_ms as f64 / 1000.0,
        });
    }

    ensure_monotonic_word_ends(&mut words);
    words
}

/// Ensure each word has end > start and ends do not overrun the next start.
pub fn ensure_monotonic_word_ends(words: &mut [TranscriptionWord]) {
    if words.is_empty() {
        return;
    }
    let len = words.len();
    for index in 0..len {
        let min_end = words[index].start_time + MIN_WORD_DURATION_SEC;
        if words[index].end_time < min_end {
            words[index].end_time = min_end;
        }
        if index + 1 < len {
            let next_start = words[index + 1].start_time;
            if next_start > words[index].start_time && words[index].end_time > next_start {
                words[index].end_time = next_start;
            }
            if words[index].end_time <= words[index].start_time {
                words[index].end_time = (words[index].start_time + MIN_WORD_DURATION_SEC)
                    .min(next_start.max(words[index].start_time + MIN_WORD_DURATION_SEC));
            }
        }
    }
}

fn ends_sentence(word: &str) -> bool {
    word.ends_with('.') || word.ends_with('?') || word.ends_with('!')
}

/// Grupuj słowa w segmenty pod SRT/VTT.
pub fn group_words_into_segments(words: &[TranscriptionWord]) -> Vec<TranscriptionSegment> {
    if words.is_empty() {
        return Vec::new();
    }

    let mut segments: Vec<TranscriptionSegment> = Vec::new();
    let mut chunk: Vec<&TranscriptionWord> = Vec::new();

    let flush = |chunk: &mut Vec<&TranscriptionWord>, segments: &mut Vec<TranscriptionSegment>| {
        if chunk.is_empty() {
            return;
        }
        let text = chunk
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        segments.push(TranscriptionSegment {
            id: format!("seg-{}", segments.len()),
            start_time: chunk[0].start_time,
            end_time: chunk[chunk.len() - 1].end_time,
            text,
        });
        chunk.clear();
    };

    for (index, word) in words.iter().enumerate() {
        if !chunk.is_empty() {
            let gap = word.start_time - chunk[chunk.len() - 1].end_time;
            if gap > SILENCE_GAP_SEC {
                flush(&mut chunk, &mut segments);
            }
        }

        chunk.push(word);

        if ends_sentence(&word.text) {
            flush(&mut chunk, &mut segments);
            continue;
        }

        if index + 1 == words.len() {
            flush(&mut chunk, &mut segments);
        }
    }

    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_timestamp_tokens_into_accurate_time_ranges() {
        let tokens = vec![
            "<|startoftranscript|>".to_string(),
            "<|it|>".to_string(),
            "<|transcribe|>".to_string(),
            "<|0.00|>".to_string(),
            " Y".to_string(),
            " ahora,".to_string(),
            " senora".to_string(),
            "<|3.00|>".to_string(),
            "<|3.00|>".to_string(),
            " nos".to_string(),
            " toca".to_string(),
            "<|5.00|>".to_string(),
        ];

        let timestamped = extract_from_whisper_timestamp_tokens(&tokens);
        assert_eq!(timestamped.len(), 5);

        assert_eq!(timestamped[0].start_ms, 0);
        assert_eq!(timestamped[2].end_ms, 3000);
        assert_eq!(timestamped[3].start_ms, 3000);
        assert_eq!(timestamped[4].end_ms, 5000);
        // Character-weighted: "ahora," is longer than "Y".
        assert!(
            timestamped[1].end_ms - timestamped[1].start_ms
                >= timestamped[0].end_ms - timestamped[0].start_ms
        );
    }

    #[test]
    fn ensure_monotonic_fills_zero_durations_from_next_start() {
        let mut words = vec![
            TranscriptionWord {
                text: "a".into(),
                start_time: 1.0,
                end_time: 1.0,
            },
            TranscriptionWord {
                text: "b".into(),
                start_time: 1.5,
                end_time: 1.5,
            },
        ];
        ensure_monotonic_word_ends(&mut words);
        assert!(words[0].end_time > words[0].start_time);
        assert!(words[0].end_time <= words[1].start_time + 1e-9);
        assert!(words[1].end_time > words[1].start_time);
    }
}
