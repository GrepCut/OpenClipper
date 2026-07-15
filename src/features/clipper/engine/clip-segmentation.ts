import { EncodedPacketSink } from "mediabunny";
import type { CaptionGroup, WordCue } from "../lib/media/transcription-export";
import { createMediabunnyInput } from "../lib/media/mediabunny-file-source";
import { clipperLog, clipperTimer } from "../shared/logger";
import { yieldToMain } from "../shared/yield-to-main";
import { groupCaptionWords } from "./transcript";

export const CLIPPER_SEGMENT_LENGTH_SEC = 60;
/** Soft lower bound when snapping clip ends to keyframes (~45s). */
export const CLIPPER_SEGMENT_MIN_SEC = 45;
/** Soft upper bound when snapping clip ends to keyframes (~90s). */
export const CLIPPER_SEGMENT_MAX_SEC = 90;

export const AUTO_PARTS_SEGMENT_LENGTH_OPTIONS = [15, 30, 45, 60] as const;
export type AutoPartsPresetSegmentLengthSec = (typeof AUTO_PARTS_SEGMENT_LENGTH_OPTIONS)[number];
export type AutoPartsSegmentLengthSec = number;

export const AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC = 5;
export const AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC = 180;

export function isPresetAutoPartsSegmentLength(
  value: number,
): value is AutoPartsPresetSegmentLengthSec {
  return (AUTO_PARTS_SEGMENT_LENGTH_OPTIONS as readonly number[]).includes(value);
}

export function formatAutoPartsSegmentLengthLabel(sec: number): string {
  if (sec === 60) return "1m";
  return `${sec}s`;
}

export function minTailForTarget(targetLengthSec: number): number {
  return Math.min(CLIPPER_SEGMENT_MIN_SEC, targetLengthSec * 0.75);
}

export function maxClipLenForTarget(targetLengthSec: number): number {
  return Math.max(targetLengthSec * 1.5, minTailForTarget(targetLengthSec));
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

export function normalizeAutoPartsSegmentLengthSec(
  value: number | undefined,
): AutoPartsSegmentLengthSec {
  if (value == null || !Number.isFinite(value)) return CLIPPER_SEGMENT_LENGTH_SEC;
  return Math.round(
    Math.min(
      AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC,
      Math.max(AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC, value),
    ),
  );
}

export interface ClipperClipSegmentWindow {
  startSec: number;
  endSec: number;
}

/** Display-only per-segment text, in the same order as `segments`. */
export interface ClipperClipSegmentTranscript {
  startSec: number;
  endSec: number;
  text: string;
}

export interface ClipperGeneratedClip {
  index: number;
  /** Overall envelope (min start, max end) across all segments. */
  startSec: number;
  endSec: number;
  durationSec: number;
  words: WordCue[];
  captionGroups: CaptionGroup[];
  /**
   * Source-video time windows that make up this clip, in playback/output
   * order. A plain contiguous clip has exactly one segment matching
   * [startSec, endSec]; an AI "supercut" clip may have several disjoint
   * windows that get concatenated into one continuous output.
   */
  segments: ClipperClipSegmentWindow[];
  /** One entry per segment: its source time range + the words spoken in it. */
  segmentTranscripts: ClipperClipSegmentTranscript[];
}

/** Stable display order — matches DB `clipIndex ASC`. */
export function sortClipsByIndex(clips: ClipperGeneratedClip[]): ClipperGeneratedClip[] {
  return [...clips].sort((a, b) => a.index - b.index);
}

export function findClipByIndex(
  clips: ClipperGeneratedClip[],
  clipIndex: number,
): ClipperGeneratedClip | null {
  return clips.find((clip) => clip.index === clipIndex) ?? null;
}

/** Picks the next sensible active clip after one is removed (stable indices, not array positions). */
export function resolveActiveClipIndexAfterDelete(
  previousActiveIndex: number,
  deletedIndex: number,
  remaining: ClipperGeneratedClip[],
): number {
  if (remaining.length === 0) return 0;
  const sorted = sortClipsByIndex(remaining);
  if (
    previousActiveIndex !== deletedIndex &&
    remaining.some((clip) => clip.index === previousActiveIndex)
  ) {
    return previousActiveIndex;
  }
  const higher = sorted.find((clip) => clip.index > deletedIndex);
  if (higher) return higher.index;
  return sorted[sorted.length - 1]!.index;
}

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

function buildClipsFromBoundaries(
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

/** Scans video keyframe timestamps from a trimmed range file (metadata-only, fast). */
export async function collectVideoKeyframeTimestamps(
  file: File,
  options: { signal?: AbortSignal; maxDurationSec?: number } = {},
): Promise<number[]> {
  const input = await createMediabunnyInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return [0];

    const sink = new EncodedPacketSink(videoTrack);
    const timestamps: number[] = [];
    let packet = await sink.getFirstPacket({ metadataOnly: true });
    let packetCount = 0;

    while (packet) {
      if (options.signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
      if (options.maxDurationSec != null && packet.timestamp > options.maxDurationSec) break;
      if (packet.type === "key") timestamps.push(packet.timestamp);
      packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
      packetCount++;
      if (packetCount % 200 === 0) {
        await yieldToMain();
      }
    }

    if (timestamps.length === 0 || timestamps[0] > 0) timestamps.unshift(0);
    return timestamps;
  } finally {
    input.dispose();
  }
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

/** Keyframe-aware segmentation from the trimmed range file; falls back to fixed splits. */
export async function segmentRangeFromTrimmedFile(
  trimmedFile: File,
  rangeDurationSec: number,
  words: WordCue[],
  wordsPerGroup: number,
  options: {
    signal?: AbortSignal;
    targetLengthSec?: number;
    onKeyframes?: (keyframes: number[]) => void;
  } = {},
): Promise<ClipperGeneratedClip[]> {
  const targetLengthSec = options.targetLengthSec ?? CLIPPER_SEGMENT_LENGTH_SEC;
  try {
    const endKeyframeScan = clipperTimer("resume: keyframe-scan");
    const keyframes = await collectVideoKeyframeTimestamps(trimmedFile, {
      signal: options.signal,
      maxDurationSec: rangeDurationSec,
    });
    endKeyframeScan();
    options.onKeyframes?.(keyframes);
    const clips = segmentRangeIntoClipsAtKeyframes(
      rangeDurationSec,
      words,
      wordsPerGroup,
      keyframes,
      targetLengthSec,
    );
    clipperLog("segment: keyframe-aligned clips", {
      clipCount: clips.length,
      keyframeCount: keyframes.length,
      targetLengthSec,
      durations: clips.map((c) => Math.round(c.durationSec)),
    });
    return clips;
  } catch (error) {
    clipperLog("segment: keyframe scan failed — fixed-length fallback", { error, targetLengthSec });
    return segmentRangeIntoClips(rangeDurationSec, words, wordsPerGroup, targetLengthSec);
  }
}
