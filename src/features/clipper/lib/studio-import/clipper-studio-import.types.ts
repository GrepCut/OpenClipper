/**
 * Shared contract for Open Clipper → GrepCut Studio ephemeral import.
 * Keep in sync with client/src/video-editor/clipper-import/clipper-studio-import.types.ts
 */

export const CLIPPER_STUDIO_IMPORT_VERSION = 1 as const;

export interface ClipperStudioNormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipperStudioImportSegment {
  /** Range-trimmed source time window start (seconds). */
  startSec: number;
  /** Range-trimmed source time window end (seconds). */
  endSec: number;
}

export interface ClipperStudioImportWord {
  text: string;
  /** Local concatenated timeline time (0 → totalDurationSec). */
  start: number;
  end: number;
}

export interface ClipperStudioImportCaptionGroup {
  words: ClipperStudioImportWord[];
  start: number;
  end: number;
}

export interface ClipperStudioCropSample {
  /** Range-trimmed source time (seconds). */
  t: number;
  crop: ClipperStudioNormalizedBox;
}

export interface ClipperStudioImportCaption {
  enabled: boolean;
  presetId: string;
  wordsPerGroup: number;
  position?: "top" | "center" | "bottom";
  size?: "small" | "medium" | "large";
}

export interface ClipperStudioImportV1 {
  version: typeof CLIPPER_STUDIO_IMPORT_VERSION;
  createdAt: string;
  /** Active preview / export format id (e.g. tiktok). */
  formatId: string;
  /** Aspect preset id from Clipper (e.g. 9-16). */
  aspectId: string;
  width: number;
  height: number;
  aspectRatio: number;
  /** Hint for Studio file picker matching (range-trimmed video preferred). */
  sourceVideoFileName: string;
  /** Suggested manifest filename written on disk. */
  manifestFileName: string;
  /** Absolute path to the project `data/` folder (JSON + video). */
  projectDataDir?: string;
  /** Absolute path to the range-trimmed video. */
  videoAbsolutePath?: string;
  /** Absolute path to the import manifest JSON. */
  manifestAbsolutePath?: string;
  /** Sum of segment durations (local timeline length). */
  totalDurationSec: number;
  segments: ClipperStudioImportSegment[];
  words: ClipperStudioImportWord[];
  captionGroups: ClipperStudioImportCaptionGroup[];
  caption: ClipperStudioImportCaption;
  /** Single-viewport AutoFlip/layout crop path for formatId. */
  cropTrack: ClipperStudioCropSample[];
  contentRect?: ClipperStudioNormalizedBox;
  solidBackgroundColor?: { r: number; g: number; b: number };
}

export function isClipperStudioImportV1(value: unknown): value is ClipperStudioImportV1 {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ClipperStudioImportV1>;
  return (
    v.version === CLIPPER_STUDIO_IMPORT_VERSION &&
    typeof v.formatId === "string" &&
    Array.isArray(v.segments) &&
    Array.isArray(v.words) &&
    Array.isArray(v.cropTrack)
  );
}
