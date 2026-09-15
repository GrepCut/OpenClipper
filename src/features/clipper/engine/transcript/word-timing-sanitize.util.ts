import type { TranscriptionSegment } from "../../../../services/types/transcription.types";
import type { WordCue } from "../../lib/media/transcription-export.util";

const MIN_WORD_DURATION_SEC = 0.02;
const DEFAULT_WORD_DURATION_SEC = 0.3;
const PACE_WINDOW_WORDS = 8;
const MAX_SECONDS_PER_SEGMENT_WORD = 3;

const wordSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

function isFiniteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Median word duration around `index`, so slow speakers do not inherit a fast global pace. */
function typicalWordDuration(words: readonly WordCue[], index: number): number {
  const durations = words
    .slice(Math.max(0, index - PACE_WINDOW_WORDS), index + PACE_WINDOW_WORDS + 1)
    .flatMap(({ start, end }) =>
      isFiniteTime(start) && isFiniteTime(end) && end > start ? [end - start] : [],
    )
    .sort((a, b) => a - b);
  if (!durations.length) return DEFAULT_WORD_DURATION_SEC;
  const middle = Math.floor(durations.length / 2);
  const median =
    durations.length % 2
      ? durations[middle]!
      : (durations[middle - 1]! + durations[middle]!) / 2;
  return Math.max(0.1, Math.min(0.7, median));
}

/**
 * Repairs ASR word timings before caption grouping and clip cutting. Whisper
 * (DTW) and cloud models often pin the first word after music or silence to
 * the start of the window, so a word can come back as 0–18 s while its end
 * stays reliable. Such extreme outliers keep their end and get a start derived
 * from the nearby speaking pace. A missing or reversed end is estimated from
 * the same pace. Overlaps are trimmed against the next word's start without
 * shifting later words, and every word stays inside `[0, durationSec]`.
 * Mirrors Studio's `whisperChunksToSegments`.
 */
export function sanitizeWordCueTimings(
  words: readonly WordCue[],
  durationSec: number,
): WordCue[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];

  const valid = words.filter(
    (word) =>
      word.text.trim().length > 0 &&
      isFiniteTime(word.start) &&
      word.start < durationSec,
  );
  const sanitized: WordCue[] = [];

  for (let index = 0; index < valid.length; index++) {
    const word = valid[index]!;
    const typicalDuration = typicalWordDuration(valid, index);
    let start = Math.max(0, word.start);
    let end = Math.min(
      durationSec,
      isFiniteTime(word.end) && word.end >= start ? word.end : start + typicalDuration,
    );

    if (end - start > Math.max(1.5, typicalDuration * 4)) {
      start = end - Math.max(0.5, typicalDuration * 2);
    }

    const nextStart = valid[index + 1]?.start;
    if (isFiniteTime(nextStart) && nextStart > start) {
      end = Math.min(end, nextStart);
    }
    start = Math.max(start, sanitized.at(-1)?.end ?? 0);
    end = Math.min(durationSec, Math.max(start + MIN_WORD_DURATION_SEC, end));
    if (end <= start) continue;

    sanitized.push({ ...word, start, end });
  }

  return sanitized;
}

/** Counts linguistic words, including languages written without spaces. */
function countSegmentWords(text: string): number {
  if (!wordSegmenter) return Math.max(1, text.split(/\s+/).filter(Boolean).length);
  let count = 0;
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.isWordLike) count++;
  }
  return Math.max(1, count);
}

/**
 * Segment-level counterpart of `sanitizeWordCueTimings` for transcriptions
 * without word timestamps: an implausibly long segment keeps its end and has
 * its start pulled forward to at most `MAX_SECONDS_PER_SEGMENT_WORD` per word.
 * Mirrors Studio's `clampStretchedSegmentStarts`.
 */
export function clampStretchedSegmentStarts(
  segments: readonly TranscriptionSegment[],
): TranscriptionSegment[] {
  return segments.map((segment) => {
    const maxDuration = countSegmentWords(segment.text) * MAX_SECONDS_PER_SEGMENT_WORD;
    if (segment.endTime - segment.startTime <= maxDuration) return segment;
    return { ...segment, startTime: segment.endTime - maxDuration };
  });
}
