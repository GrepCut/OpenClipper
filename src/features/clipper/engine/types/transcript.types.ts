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
