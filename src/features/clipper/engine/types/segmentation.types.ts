import type { CaptionGroup, WordCue } from "../../lib/media/transcription-export.util";
import type { AUTO_PARTS_SEGMENT_LENGTH_OPTIONS } from "../segmentation/segmentation.constants";

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

/** Persisted clip time envelope — JSON/DB bounds without transcript payload. */
export interface ClipperClipBounds {
  index: number;
  startSec: number;
  endSec: number;
}

export interface ClipperGeneratedClip extends ClipperClipBounds {
  /** Overall envelope duration (endSec - startSec). */
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
