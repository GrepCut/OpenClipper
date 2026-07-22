import type { CaptionGroup, WordCue } from "../../lib/media/transcription-export";
import type { AUTO_PARTS_SEGMENT_LENGTH_OPTIONS } from "../segmentation/constants";

export type AutoPartsPresetSegmentLengthSec = (typeof AUTO_PARTS_SEGMENT_LENGTH_OPTIONS)[number];
export type AutoPartsSegmentLengthSec = number;

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
