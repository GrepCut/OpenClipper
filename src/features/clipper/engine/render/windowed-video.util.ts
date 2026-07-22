import type { RebasingMediaTimestamp, RebasingVideoSample } from "../types/render.types";

/**
 * Rebases a source video sample into clip-local timestamps for windowed export.
 * Returns null when the sample lies entirely outside [windowStart, windowEnd).
 */
export function rebaseVideoSampleForWindow(
  timestampSec: number,
  durationSec: number,
  windowStartSec: number,
  windowEndSec: number,
): RebasingVideoSample | null {
  const sampleEnd = timestampSec + durationSec;

  if (sampleEnd <= windowStartSec || timestampSec >= windowEndSec) {
    return null;
  }

  if (timestampSec < windowStartSec) {
    const trimmedEnd = Math.min(sampleEnd, windowEndSec);
    const duration = trimmedEnd - windowStartSec;
    if (duration <= 0) return null;
    return { timestamp: 0, duration };
  }

  const timestamp = timestampSec - windowStartSec;
  const duration =
    sampleEnd > windowEndSec ? windowEndSec - timestampSec : durationSec;

  if (duration <= 0) return null;
  return { timestamp, duration };
}

/**
 * Rebases a media timestamp into clip-local time, shifting forward when the
 * first sample straddles windowStart (e.g. audio at 59.99s with window at 60s).
 */
export function rebaseMediaTimestampForWindow(
  timestampSec: number,
  windowStartSec: number,
  timeOffsetSec: number,
): RebasingMediaTimestamp {
  const rebased = timestampSec - windowStartSec + timeOffsetSec;
  if (rebased < 0) {
    return {
      timestamp: 0,
      timeOffset: timeOffsetSec + (windowStartSec - timestampSec),
    };
  }
  return { timestamp: rebased, timeOffset: timeOffsetSec };
}
