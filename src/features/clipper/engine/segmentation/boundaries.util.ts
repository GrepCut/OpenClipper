import type { WordCue } from "../../lib/media/transcription-export.util";
import { groupCaptionWords } from "../transcript/cues.util";
import {
  CLIPPER_SEGMENT_LENGTH_SEC,
  CLIPPER_SEGMENT_MIN_SEC,
  type ClipperGeneratedClip,
  maxClipLenForTarget,
  minTailForTarget,
} from "./segmentation.types";

function sliceWordsForSegment(
  words: WordCue[],
  segmentStart: number,
  segmentEnd: number,
): WordCue[] {
  return words
    .filter((word) => word.end > segmentStart && word.start < segmentEnd)
    .map((word) => ({
      text: word.text,
      start: Math.max(0, word.start - segmentStart),
      end: Math.min(segmentEnd - segmentStart, word.end - segmentStart),
    }));
}

export function buildClipsFromBoundaries(
  boundaries: number[],
  words: WordCue[],
  wordsPerGroup: number,
): ClipperGeneratedClip[] {
  const clips: ClipperGeneratedClip[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startSec = boundaries[i];
    const endSec = boundaries[i + 1];
    const durationSec = endSec - startSec;
    if (durationSec <= 1e-6) continue;

    const segmentWords = sliceWordsForSegment(words, startSec, endSec);
    clips.push({
      index: clips.length,
      startSec,
      endSec,
      durationSec,
      words: segmentWords,
      captionGroups: groupCaptionWords(segmentWords, wordsPerGroup),
      segments: [{ startSec, endSec }],
      segmentTranscripts: [
        { startSec, endSec, text: segmentWords.map((w) => w.text).join(" ").trim() },
      ],
    });
  }
  return clips;
}

/** Absorbs a sub-minLen tail into the previous clip instead of a tiny final segment. */
export function mergeShortTailBoundaries(
  boundaries: number[],
  minTailSec = CLIPPER_SEGMENT_MIN_SEC,
): number[] {
  const result = [...boundaries];
  while (result.length >= 3) {
    const tailLen = result[result.length - 1] - result[result.length - 2];
    if (tailLen >= minTailSec) break;
    result.splice(result.length - 2, 1);
  }
  return result;
}

function fixedBoundariesForRange(
  rangeDurationSec: number,
  targetLengthSec: number,
): number[] {
  if (rangeDurationSec <= 0) return [0];

  const boundaries: number[] = [0];
  let startSec = 0;
  while (startSec < rangeDurationSec - 1e-6) {
    const endSec = Math.min(startSec + targetLengthSec, rangeDurationSec);
    boundaries.push(endSec);
    startSec = endSec;
  }

  return mergeShortTailBoundaries(boundaries, minTailForTarget(targetLengthSec));
}

function boundariesFromClipWindows(
  clips: Array<{ startSec: number; endSec: number }>,
  rangeDurationSec: number,
): number[] {
  const sorted = [...clips].sort((a, b) => a.startSec - b.startSec);
  if (sorted.length === 0) return [0, rangeDurationSec];

  const boundaries = [sorted[0].startSec];
  for (const clip of sorted) {
    boundaries.push(clip.endSec);
  }
  if (boundaries[0] > 0.05) boundaries.unshift(0);
  if (Math.abs(boundaries[boundaries.length - 1] - rangeDurationSec) > 0.05) {
    boundaries[boundaries.length - 1] = rangeDurationSec;
  }
  return boundaries;
}

function clipWindowsFromBoundaries(
  boundaries: number[],
): Array<{ index: number; startSec: number; endSec: number }> {
  const clips: Array<{ index: number; startSec: number; endSec: number }> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startSec = boundaries[i];
    const endSec = boundaries[i + 1];
    if (endSec - startSec <= 1e-6) continue;
    clips.push({ index: clips.length, startSec, endSec });
  }
  return clips;
}

export function autoPartsBoundariesEqual(
  a: Array<{ startSec: number; endSec: number }>,
  b: Array<{ startSec: number; endSec: number }>,
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.startSec - y.startSec);
  const sortedB = [...b].sort((x, y) => x.startSec - y.startSec);
  return sortedA.every(
    (clip, i) =>
      Math.abs(clip.startSec - sortedB[i].startSec) < 0.05 &&
      Math.abs(clip.endSec - sortedB[i].endSec) < 0.05,
  );
}

/** Repairs persisted auto-parts boundaries (e.g. absorbs a short final tail). */
export function repairAutoPartsBoundaries(
  rangeDurationSec: number,
  clips: Array<{ startSec: number; endSec: number }>,
  targetLengthSec = CLIPPER_SEGMENT_LENGTH_SEC,
): Array<{ index: number; startSec: number; endSec: number }> {
  if (rangeDurationSec <= 0 || clips.length === 0) return [];

  const maxLen = maxClipLenForTarget(targetLengthSec);
  const merged = mergeShortTailBoundaries(
    boundariesFromClipWindows(clips, rangeDurationSec),
    minTailForTarget(targetLengthSec),
  );
  const windows = clipWindowsFromBoundaries(merged);
  const hasOversized = windows.some((clip) => clip.endSec - clip.startSec > maxLen + 0.05);

  const boundaries = hasOversized
    ? fixedBoundariesForRange(rangeDurationSec, targetLengthSec)
    : merged;

  return clipWindowsFromBoundaries(boundaries);
}

/**
 * Picks split points on keyframes, targeting ~targetLengthSec per clip.
 * Returns sorted boundaries including 0 and rangeDurationSec.
 */
export function planKeyframeClipBoundaries(
  keyframes: number[],
  rangeDurationSec: number,
  targetLengthSec = CLIPPER_SEGMENT_LENGTH_SEC,
): number[] {
  if (rangeDurationSec <= 0) return [0];

  const minLen = minTailForTarget(targetLengthSec);
  const maxLen = maxClipLenForTarget(targetLengthSec);

  const sortedKeys = [...new Set(keyframes.filter((k) => k >= 0 && k <= rangeDurationSec))]
    .sort((a, b) => a - b);
  if (sortedKeys.length === 0 || sortedKeys[0] > 0) sortedKeys.unshift(0);

  const boundaries = [0];
  let start = 0;

  while (start < rangeDurationSec - 1e-3) {
    const remaining = rangeDurationSec - start;
    if (remaining <= maxLen) {
      if (boundaries[boundaries.length - 1] !== rangeDurationSec) {
        boundaries.push(rangeDurationSec);
      }
      break;
    }

    const ideal = start + targetLengthSec;
    let end = Math.min(ideal, rangeDurationSec);
    let bestScore = Infinity;

    for (const k of sortedKeys) {
      if (k <= start + 1e-3) continue;
      const len = k - start;
      if (len < minLen) continue;
      if (len > maxLen) break;
      const score = Math.abs(k - ideal);
      if (score < bestScore) {
        bestScore = score;
        end = k;
      }
    }

    if (end <= start + 1e-3) {
      end = Math.min(start + targetLengthSec, rangeDurationSec);
    }

    boundaries.push(end);
    start = end;
  }

  if (boundaries[boundaries.length - 1] !== rangeDurationSec) {
    boundaries.push(rangeDurationSec);
  }

  return mergeShortTailBoundaries(boundaries, minLen);
}

/** Splits a transcribed range into fixed-length clip segments with rebased word cues. */
export function segmentRangeIntoClips(
  rangeDurationSec: number,
  words: WordCue[],
  wordsPerGroup: number,
  segmentLengthSec = CLIPPER_SEGMENT_LENGTH_SEC,
): ClipperGeneratedClip[] {
  if (rangeDurationSec <= 0) return [];

  const boundaries: number[] = [0];
  let startSec = 0;
  while (startSec < rangeDurationSec - 1e-6) {
    const endSec = Math.min(startSec + segmentLengthSec, rangeDurationSec);
    boundaries.push(endSec);
    startSec = endSec;
  }

  return buildClipsFromBoundaries(
    mergeShortTailBoundaries(boundaries, minTailForTarget(segmentLengthSec)),
    words,
    wordsPerGroup,
  );
}

/** Splits a range using keyframe-aligned boundaries (~target length per clip). */
export function segmentRangeIntoClipsAtKeyframes(
  rangeDurationSec: number,
  words: WordCue[],
  wordsPerGroup: number,
  keyframes: number[],
  targetLengthSec = CLIPPER_SEGMENT_LENGTH_SEC,
): ClipperGeneratedClip[] {
  if (rangeDurationSec <= 0) return [];
  const boundaries = planKeyframeClipBoundaries(keyframes, rangeDurationSec, targetLengthSec);
  return buildClipsFromBoundaries(boundaries, words, wordsPerGroup);
}

/** Rebuilds clip objects from persisted metadata boundaries (no keyframe scan). */
export function rebuildClipsFromGeneratedMetadata(
  generatedClips: Array<{ index: number; startSec: number; endSec: number }>,
  words: WordCue[],
  wordsPerGroup: number,
): ClipperGeneratedClip[] {
  const sorted = [...generatedClips].sort((a, b) => a.startSec - b.startSec);
  return sorted.map((gc) => {
    const durationSec = gc.endSec - gc.startSec;
    const segmentWords = sliceWordsForSegment(words, gc.startSec, gc.endSec);
    return {
      index: gc.index,
      startSec: gc.startSec,
      endSec: gc.endSec,
      durationSec,
      words: segmentWords,
      captionGroups: groupCaptionWords(segmentWords, wordsPerGroup),
      segments: [{ startSec: gc.startSec, endSec: gc.endSec }],
      segmentTranscripts: [
        {
          startSec: gc.startSec,
          endSec: gc.endSec,
          text: segmentWords.map((w) => w.text).join(" ").trim(),
        },
      ],
    };
  });
}
