import type { WordCue } from "../../lib/media/transcription-export.util";
import type {
  ClipperClipSegmentWindow,
  ClipperGeneratedClip,
} from "../types/segmentation.types";
import { groupCaptionWords } from "./cues.util";

/**
 * User edits to the range transcript. Words are never spliced out: AI/manual clips and
 * the MCP server address `rangeWords` by index, so a delete only flags the word and a
 * multi-word replace merges into the first word and flags the rest.
 */
export type TranscriptEditOp =
  | { kind: "setText"; index: number; text: string }
  | { kind: "delete"; indices: number[] }
  | { kind: "restore"; indices: number[] }
  | { kind: "replacePhrase"; indices: number[]; text: string };

/** Before/after snapshot of one range word — applied forwards for redo, backwards for undo. */
export interface TranscriptWordPatch {
  index: number;
  before: WordCue;
  after: WordCue;
}

export function isWordDeleted(word: WordCue): boolean {
  return word.deleted === true;
}

export function isWordEdited(word: WordCue): boolean {
  return word.originalText != null && word.originalText !== word.text;
}

export function visibleWords(words: readonly WordCue[]): WordCue[] {
  return words.filter((word) => !isWordDeleted(word));
}

export function visibleWordsText(words: readonly WordCue[]): string {
  return visibleWords(words)
    .map((word) => word.text)
    .join(" ")
    .trim();
}

/** Drops flag fields that hold their default value, so persisted JSON stays minimal. */
function cleanWord(word: WordCue): WordCue {
  const next: WordCue = { ...word };
  if (!next.deleted) delete next.deleted;
  if (next.originalText == null || next.originalText === next.text) delete next.originalText;
  return next;
}

function sameWord(a: WordCue, b: WordCue): boolean {
  return (
    a.text === b.text &&
    a.start === b.start &&
    a.end === b.end &&
    Boolean(a.deleted) === Boolean(b.deleted) &&
    a.originalText === b.originalText
  );
}

function normalizeEditText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** True when `text` is what the phrase already shows — committing it must not touch any word. */
export function isPhraseTextUnchanged(words: readonly WordCue[], text: string): boolean {
  const shown = visibleWordsText(words) || words.map((word) => word.text).join(" ");
  return normalizeEditText(text) === normalizeEditText(shown);
}

/** Turns an edit into per-word patches. Returns [] when nothing would change. */
export function buildTranscriptPatches(
  words: readonly WordCue[],
  op: TranscriptEditOp,
): TranscriptWordPatch[] {
  const patches: TranscriptWordPatch[] = [];
  const push = (index: number, after: WordCue) => {
    const before = words[index];
    if (!before) return;
    if (!sameWord(before, after)) patches.push({ index, before, after });
  };

  switch (op.kind) {
    case "setText": {
      const word = words[op.index];
      if (!word) return [];
      const text = normalizeEditText(op.text);
      if (!text) push(op.index, cleanWord({ ...word, deleted: true }));
      else return buildTranscriptPatches(words, { kind: "replacePhrase", indices: [op.index], text });
      break;
    }
    case "delete":
      for (const index of op.indices) {
        const word = words[index];
        if (word) push(index, cleanWord({ ...word, deleted: true }));
      }
      break;
    case "restore":
      for (const index of op.indices) {
        const word = words[index];
        if (word) push(index, cleanWord({ ...word, deleted: false }));
      }
      break;
    case "replacePhrase": {
      const indices = [...new Set(op.indices)]
        .filter((index) => words[index])
        .sort((a, b) => a - b);
      if (!indices.length) return [];
      const text = normalizeEditText(op.text);
      if (!text) {
        return buildTranscriptPatches(words, { kind: "delete", indices });
      }

      const phrase = indices.map((index) => ({ index, word: words[index]! }));
      const live = phrase.filter(({ word }) => !isWordDeleted(word));
      const slots = live.length ? live : phrase;
      const tokens = text.split(" ");
      const m = slots.length;
      const n = tokens.length;

      const assign = (from: number, to: number, slotText: string) => {
        const group = slots.slice(from, to);
        const [head, ...rest] = group;
        if (!head) return;
        push(
          head.index,
          cleanWord({
            ...head.word,
            text: slotText,
            deleted: false,
            originalText: group.map(({ word }) => word.originalText ?? word.text).join(" "),
            end: Math.max(...group.map(({ word }) => word.end)),
          }),
        );
        for (const { index, word } of rest) push(index, cleanWord({ ...word, deleted: true }));
      };

      if (n <= m) {
        for (let k = 0; k < n; k++) {
          assign(Math.floor((k * m) / n), Math.floor(((k + 1) * m) / n), tokens[k]!);
        }
      } else {
        for (let i = 0; i < m; i++) {
          const slotTokens = tokens.slice(Math.floor((i * n) / m), Math.floor(((i + 1) * n) / m));
          assign(i, i + 1, slotTokens.join(" "));
        }
      }
      break;
    }
  }
  return patches;
}

export function applyTranscriptPatches(
  words: readonly WordCue[],
  patches: readonly TranscriptWordPatch[],
  direction: "forward" | "backward",
): WordCue[] {
  const next = [...words];
  const ordered = direction === "forward" ? patches : [...patches].reverse();
  for (const patch of ordered) {
    if (patch.index < next.length) {
      next[patch.index] = direction === "forward" ? patch.after : patch.before;
    }
  }
  return next;
}

/** One clip word's position in `rangeWords` and in the clip's `segments` (-1 when unmatched). */
export interface ClipWordRef {
  rangeIndex: number;
  segmentIndex: number;
}

const MATCH_WINDOW_SEC = 2;

function lowerBoundByStart(words: readonly WordCue[], timeSec: number): number {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start < timeSec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clipSegments(clip: ClipperGeneratedClip): ClipperClipSegmentWindow[] {
  return clip.segments?.length
    ? clip.segments
    : [{ startSec: clip.startSec, endSec: clip.endSec }];
}

/**
 * Maps each `clip.words` entry back to its `rangeWords` index. Clip words are clip-local
 * copies (segment offsets applied, edges clamped), so the match is by source time with
 * text as the tie-breaker; edits never move a word's start, so the mapping is stable.
 * Clip words are an ordered slice of `rangeWords`, so within a segment the mapping is
 * strictly increasing: two clip words never claim the same range word.
 */
export function mapClipWordsToRange(
  clip: ClipperGeneratedClip,
  rangeWords: readonly WordCue[],
): ClipWordRef[] {
  const segments = clipSegments(clip);
  const offsets: number[] = [];
  let acc = 0;
  for (const segment of segments) {
    offsets.push(acc);
    acc += Math.max(0, segment.endSec - segment.startSec);
  }

  let segmentIndex = 0;
  let cursor = 0;
  return clip.words.map((word) => {
    const previousSegmentIndex = segmentIndex;
    while (
      segmentIndex < segments.length - 1 &&
      word.start >= offsets[segmentIndex + 1]! - 1e-6
    ) {
      segmentIndex++;
    }
    if (segmentIndex !== previousSegmentIndex) cursor = 0;
    const segment = segments[segmentIndex]!;
    const shift = segment.startSec - offsets[segmentIndex]!;
    const sourceStart = word.start + shift;
    const sourceEnd = word.end + shift;

    let best = -1;
    let bestScore = Infinity;
    for (
      let j = Math.max(cursor, lowerBoundByStart(rangeWords, sourceStart - MATCH_WINDOW_SEC));
      j < rangeWords.length && rangeWords[j]!.start <= sourceEnd + MATCH_WINDOW_SEC;
      j++
    ) {
      const candidate = rangeWords[j]!;
      const timeError = Math.min(
        Math.abs(candidate.start - sourceStart),
        Math.abs(candidate.end - sourceEnd),
      );
      const score = timeError + (candidate.text === word.text ? 0 : MATCH_WINDOW_SEC);
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best >= 0) cursor = best + 1;
    return { rangeIndex: best, segmentIndex };
  });
}

/**
 * Re-applies range-word patches to a clip's local word copies. Returns the same clip
 * object when no word changed, so callers can skip untouched clips.
 */
export function patchClipWords(
  clip: ClipperGeneratedClip,
  previousRangeWords: readonly WordCue[],
  patchesByIndex: ReadonlyMap<number, { before: WordCue; after: WordCue }>,
  wordsPerGroup: number,
): ClipperGeneratedClip {
  if (!clip.words.length) return clip;
  const refs = mapClipWordsToRange(clip, previousRangeWords);
  let changed = false;
  const words = clip.words.map((word, k) => {
    const patch = patchesByIndex.get(refs[k]!.rangeIndex);
    if (!patch) return word;
    changed = true;
    const { before, after } = patch;
    return cleanWord({
      ...word,
      text: after.text,
      deleted: after.deleted,
      originalText: after.originalText,
      end: Math.max(word.start, word.end + (after.end - before.end)),
    });
  });
  if (!changed) return clip;

  const segmentTranscripts = clip.segmentTranscripts.map((transcript, segmentIndex) => ({
    ...transcript,
    text: visibleWordsText(words.filter((_, k) => refs[k]!.segmentIndex === segmentIndex)),
  }));

  return {
    ...clip,
    words,
    captionGroups: groupCaptionWords(words, wordsPerGroup),
    segmentTranscripts,
  };
}
