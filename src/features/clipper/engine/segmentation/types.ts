import type { CaptionGroup, WordCue } from "../../lib/media/transcription-export";

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
