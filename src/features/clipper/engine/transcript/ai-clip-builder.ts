import type { CaptionGroup, WordCue } from "../../lib/media/transcription-export";
import { groupCaptionWords } from "./cues";
import type {
  ClipperClipSegmentTranscript,
  ClipperClipSegmentWindow,
  ClipperGeneratedClip,
} from "../segmentation/types";
import type { RmsEnvelope } from "../audio/envelope";
import { padSegmentWindows, type WordMarginOptions } from "./word-boundaries";

export interface AiClipSegmentRange {
  wordStartIdx: number;
  wordEndIdx: number;
}

export interface AiClipWordRange {
  segments: AiClipSegmentRange[];
  label?: string;
  index?: number;
}

function sliceWordsByIndexRange(
  words: WordCue[],
  wordStartIdx: number,
  wordEndIdx: number,
  /** Local (clip-relative) time at which this segment's words should start. */
  localOffsetSec: number,
  segmentStartSec: number,
): WordCue[] {
  const selected = words.slice(wordStartIdx, wordEndIdx + 1);
  return selected.map((word) => ({
    text: word.text,
    start: localOffsetSec + Math.max(0, word.start - segmentStartSec),
    end: localOffsetSec + Math.max(0, word.end - segmentStartSec),
  }));
}

/** Builds clipper clips from AI word-index ranges (overlaps allowed; a clip may be a multi-segment supercut). */
export function buildClipsFromWordRanges(
  rangeWords: WordCue[],
  ranges: AiClipWordRange[],
  wordsPerGroup: number,
  rangeDurationSec = Infinity,
  margins?: WordMarginOptions,
  envelope?: RmsEnvelope,
): ClipperGeneratedClip[] {
  if (!rangeWords.length || !ranges.length) return [];

  const clips: ClipperGeneratedClip[] = [];

  for (const range of ranges) {
    if (!range.segments.length) continue;

    const segments: ClipperClipSegmentWindow[] = [];
    const segmentTranscripts: ClipperClipSegmentTranscript[] = [];
    const words: WordCue[] = [];
    let localOffsetSec = 0;

    const normalizedSegments = range.segments.map((seg) => ({
      wordStartIdx: Math.max(0, Math.floor(seg.wordStartIdx)),
      wordEndIdx: Math.min(rangeWords.length - 1, Math.floor(seg.wordEndIdx)),
    }));
    const paddedWindows = padSegmentWindows(normalizedSegments, rangeWords, rangeDurationSec, margins, envelope);

    for (let segmentIndex = 0; segmentIndex < normalizedSegments.length; segmentIndex++) {
      const { wordStartIdx, wordEndIdx } = normalizedSegments[segmentIndex]!;
      if (wordEndIdx < wordStartIdx) continue;

      const { startSec: segmentStartSec, endSec: segmentEndSec } = paddedWindows[segmentIndex]!;
      const segmentDurationSec = segmentEndSec - segmentStartSec;
      if (segmentDurationSec <= 1e-6) continue;

      const segmentWords = sliceWordsByIndexRange(
        rangeWords,
        wordStartIdx,
        wordEndIdx,
        localOffsetSec,
        segmentStartSec,
      );
      words.push(...segmentWords);
      segments.push({ startSec: segmentStartSec, endSec: segmentEndSec });
      segmentTranscripts.push({
        startSec: segmentStartSec,
        endSec: segmentEndSec,
        text: segmentWords.map((w) => w.text).join(" ").trim(),
      });
      localOffsetSec += segmentDurationSec;
    }

    if (!segments.length || !words.length) continue;

    const startSec = Math.min(...segments.map((s) => s.startSec));
    const endSec = Math.max(...segments.map((s) => s.endSec));
    const durationSec = localOffsetSec;

    const captionGroups: CaptionGroup[] = groupCaptionWords(words, wordsPerGroup);

    clips.push({
      index: range.index ?? clips.length,
      startSec,
      endSec,
      durationSec,
      words,
      captionGroups,
      segments,
      segmentTranscripts,
    });
  }

  return clips;
}

export interface AiClipPickInput {
  index: number;
  segments: AiClipSegmentRange[];
  startSec: number;
  endSec: number;
  durationSec: number;
  label?: string;
}

/** Maps API clip picks into word ranges for local clip building. */
export function aiClipPicksToWordRanges(
  picks: AiClipPickInput[],
): AiClipWordRange[] {
  return picks.map((pick) => ({
    segments: pick.segments.map((s) => ({
      wordStartIdx: s.wordStartIdx,
      wordEndIdx: s.wordEndIdx,
    })),
    label: pick.label,
    index: pick.index,
  }));
}
