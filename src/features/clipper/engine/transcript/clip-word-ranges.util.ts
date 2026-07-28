import type { WordCue } from "../../lib/media/transcription-export.util";
import type { ClipperClipPayload } from "../../persistence/clipper-clips-api.util";
import type { RmsEnvelope } from "../types/audio.types";
import type { ClipperGeneratedClip } from "../types/segmentation.types";
import type { AiClipSegmentRange, WordMarginOptions } from "../types/transcript.types";
import { padSegmentWindows } from "./word-boundaries.util";

/** Groups sorted global word indices into contiguous inclusive ranges. */
function groupContiguousWordIndices(indices: number[]): AiClipSegmentRange[] {
  if (!indices.length) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges: AiClipSegmentRange[] = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) end = sorted[i];
    else {
      ranges.push({ wordStartIdx: start, wordEndIdx: end });
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push({ wordStartIdx: start, wordEndIdx: end });
  return ranges;
}

/** Maps a clip's source-time segments to global rangeWords indices. */
export function deriveWordRangesFromClip(
  clip: ClipperGeneratedClip,
  rangeWords: WordCue[],
): AiClipSegmentRange[] {
  if (!rangeWords.length || !clip.segments.length) return [];

  const indices: number[] = [];
  for (let i = 0; i < rangeWords.length; i++) {
    const word = rangeWords[i];
    if (clip.segments.some((segment) => word.end > segment.startSec && word.start < segment.endSec)) {
      indices.push(i);
    }
  }
  return groupContiguousWordIndices(indices);
}

export function clipPayloadFromWordRanges(
  index: number,
  segments: AiClipSegmentRange[],
  rangeWords: WordCue[],
  label?: string,
  rangeDurationSec = Infinity,
  margins?: WordMarginOptions,
  envelope?: RmsEnvelope,
): ClipperClipPayload | null {
  if (!segments.length || !rangeWords.length) return null;

  const windows = padSegmentWindows(segments, rangeWords, rangeDurationSec, margins, envelope);
  const payloadSegments = segments.map((segment, orderIndex) => {
    const window = windows[orderIndex]!;
    return {
      orderIndex,
      startSec: window.startSec,
      endSec: window.endSec,
      wordStartIdx: segment.wordStartIdx,
      wordEndIdx: segment.wordEndIdx,
    };
  });

  return {
    index,
    startSec: Math.min(...payloadSegments.map((segment) => segment.startSec)),
    endSec: Math.max(...payloadSegments.map((segment) => segment.endSec)),
    label,
    segments: payloadSegments,
  };
}
