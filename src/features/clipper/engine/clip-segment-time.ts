import type { ClipperClipSegmentWindow } from "./clip-segmentation";

/** Total duration spanned by a clip's segments (sum, ignoring gaps between them). */
export function segmentsTotalDuration(segments: ClipperClipSegmentWindow[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.endSec - s.startSec), 0);
}

/**
 * Maps a 0-based local time (matching the clip's concatenated virtual timeline,
 * i.e. the same timeline `words`/`captionGroups` are rebased to) into an
 * absolute source-video time. Used to seek the `<video>` element.
 */
export function localTimeToSourceTime(
  segments: ClipperClipSegmentWindow[],
  localSec: number,
): number {
  if (!segments.length) return 0;

  let remaining = Math.max(0, localSec);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const duration = Math.max(0, segment.endSec - segment.startSec);
    const isLast = i === segments.length - 1;
    if (remaining <= duration || isLast) {
      return segment.startSec + Math.min(duration, remaining);
    }
    remaining -= duration;
  }
  return segments[0].startSec;
}

/**
 * Maps an absolute source-video time back into 0-based local clip time.
 * A time inside a gap between segments (or before/after the clip) is
 * clamped to the nearest segment boundary.
 */
export function sourceTimeToLocalTime(
  segments: ClipperClipSegmentWindow[],
  sourceSec: number,
): number {
  if (!segments.length) return 0;

  let cumulative = 0;
  for (const segment of segments) {
    const duration = Math.max(0, segment.endSec - segment.startSec);
    if (sourceSec < segment.endSec) {
      const withinSegment = Math.max(0, sourceSec - segment.startSec);
      return cumulative + Math.min(duration, withinSegment);
    }
    cumulative += duration;
  }
  return cumulative;
}

/** Index of the segment containing `sourceSec`, or the last segment if past the end. */
export function segmentIndexForSourceTime(
  segments: ClipperClipSegmentWindow[],
  sourceSec: number,
): number {
  for (let i = 0; i < segments.length; i++) {
    if (sourceSec < segments[i].endSec) return i;
  }
  return Math.max(0, segments.length - 1);
}

/**
 * During normal (non-scrubbing) playback, the `<video>` element advances
 * through absolute source time and doesn't know about gaps between
 * segments. If `sourceSec` has passed a non-last segment's end without yet
 * reaching the next segment's start, returns the next segment's start to
 * seek to — otherwise returns null (no jump needed).
 */
export function findGapJumpTarget(
  segments: ClipperClipSegmentWindow[],
  sourceSec: number,
  epsilon = 0.05,
): number | null {
  for (let i = 0; i < segments.length - 1; i++) {
    if (sourceSec >= segments[i].endSec - epsilon && sourceSec < segments[i + 1].startSec) {
      return segments[i + 1].startSec;
    }
  }
  return null;
}
