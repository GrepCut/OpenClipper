import type { WordCue } from "../../lib/media/transcription-export";
import type { ClipperClipPayload } from "../../persistence/clipper-clips-api";
import { buildClipsFromWordRanges } from "./ai-clip-builder";
import type { AiClipSegmentRange } from "../types/transcript";
import type { ClipperGeneratedClip } from "../types/segmentation";
import type { RmsEnvelope } from "../types/audio";
import { padSegmentWindows } from "./word-boundaries";
import type { WordMarginOptions } from "../types/transcript";
import type { ClipTranscriptEditOp, ClipTranscriptEditResult, WordSelection } from "../types/transcript";

/** Groups sorted global word indices into contiguous inclusive ranges. */
export function groupContiguousWordIndices(indices: number[]): AiClipSegmentRange[] {
  if (!indices.length) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  return groupPlaybackWordIndices(sorted);
}

/** Groups flat playback-order indices; breaks when global indices are not consecutive. */
export function groupPlaybackWordIndices(flat: number[]): AiClipSegmentRange[] {
  if (!flat.length) return [];

  const ranges: AiClipSegmentRange[] = [];
  let start = flat[0];
  let end = flat[0];

  for (let i = 1; i < flat.length; i++) {
    if (flat[i] === end + 1) {
      end = flat[i];
    } else {
      ranges.push({ wordStartIdx: start, wordEndIdx: end });
      start = flat[i];
      end = flat[i];
    }
  }
  ranges.push({ wordStartIdx: start, wordEndIdx: end });
  return ranges;
}

export function flattenWordRanges(ranges: AiClipSegmentRange[]): number[] {
  const result: number[] = [];
  for (const range of ranges) {
    for (let i = range.wordStartIdx; i <= range.wordEndIdx; i++) {
      result.push(i);
    }
  }
  return result;
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
    const inSegment = clip.segments.some(
      (seg) => word.end > seg.startSec && word.start < seg.endSec,
    );
    if (inSegment) indices.push(i);
  }
  return groupContiguousWordIndices(indices);
}

export function deleteWordSelection(
  ranges: AiClipSegmentRange[],
  selection: WordSelection,
): AiClipSegmentRange[] {
  const flat = flattenWordRanges(ranges);
  const filtered = flat.filter((i) => i < selection.startIdx || i > selection.endIdx);
  return groupPlaybackWordIndices(filtered);
}

export function cutWordSelection(
  ranges: AiClipSegmentRange[],
  selection: WordSelection,
): { ranges: AiClipSegmentRange[]; cut: AiClipSegmentRange[] } {
  const flat = flattenWordRanges(ranges);
  const cutIndices = flat.filter((i) => i >= selection.startIdx && i <= selection.endIdx);
  const remaining = flat.filter((i) => i < selection.startIdx || i > selection.endIdx);
  return {
    ranges: groupPlaybackWordIndices(remaining),
    cut: groupPlaybackWordIndices(cutIndices),
  };
}

export function copyWordSelection(
  ranges: AiClipSegmentRange[],
  selection: WordSelection,
): AiClipSegmentRange[] {
  const flat = flattenWordRanges(ranges);
  const copied = flat.filter((i) => i >= selection.startIdx && i <= selection.endIdx);
  return groupPlaybackWordIndices(copied);
}

/**
 * Inserts clipboard word ranges at a position in the flattened clip word list.
 * `insertAtFlatIndex` is 0-based position in playback order (0 = before first word).
 */
export function insertWordRangesAt(
  ranges: AiClipSegmentRange[],
  insertAtFlatIndex: number,
  inserted: AiClipSegmentRange[],
): AiClipSegmentRange[] {
  const flat = flattenWordRanges(ranges);
  const insertedFlat = flattenWordRanges(inserted);
  const at = Math.max(0, Math.min(insertAtFlatIndex, flat.length));
  return groupPlaybackWordIndices([
    ...flat.slice(0, at),
    ...insertedFlat,
    ...flat.slice(at),
  ]);
}

/** Flat list index of the first selected word, or end of clip when selection is empty. */
export function selectionInsertFlatIndex(
  ranges: AiClipSegmentRange[],
  selection: WordSelection | null,
): number {
  const flat = flattenWordRanges(ranges);
  if (!selection || selection.startIdx > selection.endIdx) return flat.length;
  const idx = flat.findIndex((i) => i >= selection.startIdx);
  return idx === -1 ? flat.length : idx;
}

export function applyClipTranscriptEdit(
  ranges: AiClipSegmentRange[],
  op: ClipTranscriptEditOp,
): ClipTranscriptEditResult {
  switch (op.type) {
    case "delete": {
      const next = deleteWordSelection(ranges, op.selection);
      return {
        ranges: next,
        editedRange: op.selection,
        isEmpty: next.length === 0,
      };
    }
    case "cut": {
      const { ranges: next, cut } = cutWordSelection(ranges, op.selection);
      return {
        ranges: next,
        editedRange: op.selection,
        isEmpty: next.length === 0,
        clipboard: cut,
      };
    }
    case "copy": {
      return {
        ranges,
        editedRange: op.selection,
        isEmpty: false,
        clipboard: copyWordSelection(ranges, op.selection),
      };
    }
    case "paste": {
      const clipboard = op.clipboard ?? [];
      if (!clipboard.length) {
        return { ranges, editedRange: null, isEmpty: ranges.length === 0 };
      }
      const withoutSelection =
        op.selection.startIdx <= op.selection.endIdx
          ? deleteWordSelection(ranges, op.selection)
          : ranges;
      const insertAt = selectionInsertFlatIndex(withoutSelection, op.selection);
      const next = insertWordRangesAt(withoutSelection, insertAt, clipboard);
      const insertedFlat = flattenWordRanges(clipboard);
      const editedRange =
        insertedFlat.length > 0
          ? {
              startIdx: insertedFlat[0],
              endIdx: insertedFlat[insertedFlat.length - 1],
            }
          : null;
      return {
        ranges: next,
        editedRange,
        isEmpty: next.length === 0,
      };
    }
  }
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
  const payloadSegments = segments.map((seg, orderIndex) => {
    const window = windows[orderIndex]!;
    return {
      orderIndex,
      startSec: window.startSec,
      endSec: window.endSec,
      wordStartIdx: seg.wordStartIdx,
      wordEndIdx: seg.wordEndIdx,
    };
  });

  return {
    index,
    startSec: Math.min(...payloadSegments.map((s) => s.startSec)),
    endSec: Math.max(...payloadSegments.map((s) => s.endSec)),
    label,
    segments: payloadSegments,
  };
}

export function rebuildClipFromWordRanges(
  clipIndex: number,
  ranges: AiClipSegmentRange[],
  rangeWords: WordCue[],
  wordsPerGroup: number,
  label?: string,
  rangeDurationSec = Infinity,
  margins?: WordMarginOptions,
  envelope?: RmsEnvelope,
): ClipperGeneratedClip | null {
  const clips = buildClipsFromWordRanges(
    rangeWords,
    [{ segments: ranges, index: clipIndex, label }],
    wordsPerGroup,
    rangeDurationSec,
    margins,
    envelope,
  );
  return clips[0] ?? null;
}

/** Maps a displayed word's global index to flat position within clip ranges. */
export function flatIndexForGlobalWord(
  ranges: AiClipSegmentRange[],
  globalIdx: number,
): number {
  const flat = flattenWordRanges(ranges);
  return flat.indexOf(globalIdx);
}

export function globalWordsInClip(
  clip: ClipperGeneratedClip,
  rangeWords: WordCue[],
): Array<{ globalIdx: number; word: WordCue }> {
  const ranges = deriveWordRangesFromClip(clip, rangeWords);
  const flat = flattenWordRanges(ranges);
  return flat.map((globalIdx) => ({ globalIdx, word: rangeWords[globalIdx] }));
}
