import type { WordCue } from "../lib/media/transcription-export.util";

export interface WordRangeSelection {
  startIdx: number | null;
  endIdx: number | null;
}

export function nextWordRangeSelection(
  current: WordRangeSelection,
  clickedIdx: number,
): WordRangeSelection {
  const { startIdx, endIdx } = current;
  if (startIdx == null) return { startIdx: clickedIdx, endIdx: null };
  if (endIdx == null) {
    if (clickedIdx === startIdx) return { startIdx: clickedIdx, endIdx: clickedIdx };
    return clickedIdx < startIdx
      ? { startIdx: clickedIdx, endIdx: startIdx }
      : { startIdx, endIdx: clickedIdx };
  }

  return { startIdx: clickedIdx, endIdx: null };
}

export function wordRangeTimes(
  words: WordCue[],
  startIdx: number | null,
  endIdx: number | null,
): { startSec: number; endSec: number } | null {
  if (startIdx == null || endIdx == null) return null;
  const startWord = words[Math.min(startIdx, endIdx)];
  const endWord = words[Math.max(startIdx, endIdx)];
  if (!startWord || !endWord) return null;
  return { startSec: startWord.start, endSec: endWord.end };
}

export function timeRangeFromSelection(
  words: WordCue[],
  selection: WordRangeSelection,
): [number, number] | null {
  const times = wordRangeTimes(words, selection.startIdx, selection.endIdx);
  if (!times) return null;
  return [times.startSec, times.endSec];
}

/**
 * Word whose cue contains `timeSec`, otherwise the nearest cue.
 * Binary search — `words` are ordered by start time; called on every slider tick.
 */
export function wordIndexAtTime(words: WordCue[], timeSec: number): number | null {
  if (!words.length) return null;

  let lo = 0;
  let hi = words.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start <= timeSec) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx === -1) return 0;

  const word = words[idx]!;
  const next = words[idx + 1];
  if (timeSec <= word.end || !next) return idx;
  return timeSec - word.end <= next.start - timeSec ? idx : idx + 1;
}

export function selectionFromTimeRange(
  words: WordCue[],
  startSec: number,
  endSec: number,
): WordRangeSelection {
  const lo = Math.min(startSec, endSec);
  const hi = Math.max(startSec, endSec);
  const startIdx = wordIndexAtTime(words, lo);
  const endIdx = wordIndexAtTime(words, hi);
  if (startIdx == null || endIdx == null) return { startIdx: null, endIdx: null };
  return startIdx <= endIdx
    ? { startIdx, endIdx }
    : { startIdx: endIdx, endIdx: startIdx };
}
