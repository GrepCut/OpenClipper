use super::types::{TranscriptionSegment, TranscriptionWord};
use sherpa_onnx::OfflineRecognizerResult;

const SENTENCEPIECE_SPACE: char = '\u{2581}';
const SILENCE_GAP_SEC: f64 = 0.8;

#[derive(Debug, Clone, PartialEq)]
pub struct TimestampedToken {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

pub fn extract_timestamped_tokens(result: &OfflineRecognizerResult) -> Vec<TimestampedToken> {
    let timestamps = result.timestamps.as_deref().unwrap_or(&[]);
    let durations = result.durations.as_deref().unwrap_or(&[]);

    result
        .tokens
        .iter()
        .enumerate()
        .map(|(index, token)| {
            let start = timestamps.get(index).copied().unwrap_or_default();
            let duration = durations.get(index).copied().unwrap_or_default();
            TimestampedToken {
                text: token.clone(),
                start_ms: (start * 1000.0).round() as u64,
                end_ms: ((start + duration) * 1000.0).round() as u64,
            }
        })
        .collect()
}

fn is_word_start(token: &str) -> bool {
    token.starts_with(SENTENCEPIECE_SPACE) || token.starts_with(' ')
}

fn normalize_token_text(token: &str) -> String {
    token
        .trim_start_matches(SENTENCEPIECE_SPACE)
        .trim_start_matches(' ')
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

    words
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
    fn merge_sentencepiece_tokens_joins_subwords() {
        let tokens = vec![
            TimestampedToken {
                text: "▁To".into(),
                start_ms: 320,
                end_ms: 560,
            },
            TimestampedToken {
                text: "▁jest".into(),
                start_ms: 560,
                end_ms: 880,
            },
            TimestampedToken {
                text: "▁przyk".into(),
                start_ms: 900,
                end_ms: 1100,
            },
            TimestampedToken {
                text: "ład".into(),
                start_ms: 1100,
                end_ms: 1400,
            },
        ];

        let words = merge_sentencepiece_tokens(&tokens);
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "To");
        assert_eq!(words[1].text, "jest");
        assert_eq!(words[2].text, "przykład");
        assert!((words[2].start_time - 0.9).abs() < 0.001);
    }

    #[test]
    fn group_words_into_segments_splits_on_punctuation() {
        let words = vec![
            TranscriptionWord {
                text: "To".into(),
                start_time: 0.32,
                end_time: 0.56,
            },
            TranscriptionWord {
                text: "jest".into(),
                start_time: 0.56,
                end_time: 0.88,
            },
            TranscriptionWord {
                text: "test.".into(),
                start_time: 0.88,
                end_time: 1.2,
            },
        ];

        let segments = group_words_into_segments(&words);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "To jest test.");
    }

    #[test]
    fn group_words_into_segments_splits_on_silence_gap() {
        let words = vec![
            TranscriptionWord {
                text: "Pierwsze".into(),
                start_time: 0.0,
                end_time: 0.5,
            },
            TranscriptionWord {
                text: "drugie".into(),
                start_time: 2.0,
                end_time: 2.5,
            },
        ];

        let segments = group_words_into_segments(&words);
        assert_eq!(segments.len(), 2);
    }
}
