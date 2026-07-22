export interface WordSelection {
  startIdx: number;
  endIdx: number;
}

export type ClipTranscriptEditOp =
  | { type: "delete"; selection: WordSelection }
  | { type: "cut"; selection: WordSelection }
  | { type: "copy"; selection: WordSelection }
  | { type: "paste"; selection: WordSelection; clipboard?: AiClipSegmentRange[] };

export interface ClipTranscriptEditResult {
  ranges: AiClipSegmentRange[];
  editedRange: WordSelection | null;
  isEmpty: boolean;
  clipboard?: AiClipSegmentRange[];
}

export interface AiClipSegmentRange {
  wordStartIdx: number;
  wordEndIdx: number;
}

export interface AiClipWordRange {
  segments: AiClipSegmentRange[];
  label?: string;
  index?: number;
}

export interface AiClipPickInput {
  index: number;
  segments: AiClipSegmentRange[];
  startSec: number;
  endSec: number;
  durationSec: number;
  label?: string;
}

export interface WordMarginOptions {
  preRollSec?: number;
  postRollSec?: number;
  minGapSec?: number;
}
