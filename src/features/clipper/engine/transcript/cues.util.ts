import type {
  Transcription,
  TranscriptionSegment,
  TranscriptionWord,
} from "../../../../services/types/transcription.types";
import {
  segmentsToWordCues,
  wordCuesToCaptionGroups,
  type CaptionGroup,
  type WordCue,
} from "../../lib/media/transcription-export.util";

export function sliceSegmentsForWindow(
  segments: TranscriptionSegment[],
  end: number,
): TranscriptionSegment[] {
  return segments
    .filter((segment) => segment.endTime > 0 && segment.startTime < end)
    .map((segment) => ({
      ...segment,
      startTime: Math.max(0, segment.startTime),
      endTime: Math.min(end, segment.endTime),
    }));
}

function sliceWordsForWindow(words: TranscriptionWord[], end: number): WordCue[] {
  return words
    .filter((word) => word.endTime > 0 && word.startTime < end)
    .map((word) => ({
      text: word.text,
      start: Math.max(0, word.startTime),
      end: Math.min(end, word.endTime),
    }));
}

/** Flat word cues for the clip window — grouped into phrase caption blocks at render time. */
export function buildWordCuesForClip(
  segments: TranscriptionSegment[],
  clipDurationSec: number,
): WordCue[] {
  return segmentsToWordCues(sliceSegmentsForWindow(segments, clipDurationSec));
}

/** Uses Parakeet word timestamps, falling back to segment interpolation if unavailable. */
export function buildWordCuesForTranscription(
  transcription: Transcription,
  clipDurationSec: number,
): WordCue[] {
  if (transcription.words?.length) {
    return sliceWordsForWindow(transcription.words, clipDurationSec);
  }
  return buildWordCuesForClip(transcription.segments, clipDurationSec);
}

export function groupCaptionWords(words: WordCue[], wordsPerGroup: number): CaptionGroup[] {
  return wordCuesToCaptionGroups(words, wordsPerGroup);
}
