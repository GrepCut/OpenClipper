import type {
  AutoPartsPresetSegmentLengthSec,
  AutoPartsSegmentLengthSec,
  ClipperGeneratedClip,
} from "../types/segmentation";
export type {
  AutoPartsPresetSegmentLengthSec,
  AutoPartsSegmentLengthSec,
  ClipperClipSegmentTranscript,
  ClipperClipSegmentWindow,
  ClipperGeneratedClip,
} from "../types/segmentation";
export {
  AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC,
  AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC,
  AUTO_PARTS_SEGMENT_LENGTH_OPTIONS,
  CLIPPER_SEGMENT_LENGTH_SEC,
  CLIPPER_SEGMENT_MAX_SEC,
  CLIPPER_SEGMENT_MIN_SEC,
} from "./constants";

import {
  AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC,
  AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC,
  AUTO_PARTS_SEGMENT_LENGTH_OPTIONS,
  CLIPPER_SEGMENT_LENGTH_SEC,
  CLIPPER_SEGMENT_MIN_SEC,
} from "./constants";

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
