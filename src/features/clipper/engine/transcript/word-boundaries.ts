import type { WordCue } from "../../lib/media/transcription-export";
import { refineBoundaryToSilence } from "../audio/envelope";
import type { RmsEnvelope } from "../types/audio";
import type { WordMarginOptions } from "../types/transcript";

export const DEFAULT_WORD_MARGINS: Required<WordMarginOptions> = {
  preRollSec: 0.12,
  postRollSec: 0.18,
  minGapSec: 0.06,
};

interface SegmentLimits {
  baseStart: number;
  baseEnd: number;
  startMin: number;
  endMax: number;
}

export function padSegmentWindows(
  segments: { wordStartIdx: number; wordEndIdx: number }[],
  rangeWords: WordCue[],
  rangeDurationSec: number,
  opts: WordMarginOptions = {},
  envelope?: RmsEnvelope,
): Array<{ startSec: number; endSec: number }> {
  const options = { ...DEFAULT_WORD_MARGINS, ...opts };
  const duration = Math.max(0, rangeDurationSec);
  const limits: SegmentLimits[] = segments.map((segment) => {
    const startWord = rangeWords[segment.wordStartIdx];
    const endWord = rangeWords[segment.wordEndIdx];
    if (!startWord || !endWord) throw new Error(`Invalid word index range ${segment.wordStartIdx}..${segment.wordEndIdx}`);
    const baseStart = Math.max(0, Math.min(duration, startWord.start));
    const baseEnd = Math.max(baseStart + 0.05, endWord.end);
    const gapBefore = Math.max(0, startWord.start - (rangeWords[segment.wordStartIdx - 1]?.end ?? 0));
    const gapAfter = Math.max(0, (rangeWords[segment.wordEndIdx + 1]?.start ?? duration) - endWord.end);
    return {
      baseStart,
      baseEnd: Math.min(duration, baseEnd),
      startMin: Math.max(0, baseStart - Math.min(options.preRollSec, gapBefore)),
      endMax: Math.min(duration, baseEnd + Math.min(options.postRollSec, gapAfter)),
    };
  });

  for (let i = 0; i < limits.length - 1; i++) {
    const current = limits[i]!;
    const next = limits[i + 1]!;
    const gap = next.baseStart - current.baseEnd;
    const sharedBudget = gap > options.minGapSec ? (gap - options.minGapSec) / 2 : 0;
    current.endMax = Math.min(current.endMax, current.baseEnd + sharedBudget);
    next.startMin = Math.max(next.startMin, next.baseStart - sharedBudget);
  }

  return limits.map((limit) => {
    let startSec = limit.startMin;
    let endSec = limit.endMax;
    if (envelope) {
      startSec = refineBoundaryToSilence(envelope, startSec, 0.15, limit.startMin, limit.baseStart);
      endSec = refineBoundaryToSilence(envelope, endSec, 0.15, limit.baseEnd, limit.endMax);
    }
    return { startSec, endSec: Math.max(startSec, endSec) };
  });
}
