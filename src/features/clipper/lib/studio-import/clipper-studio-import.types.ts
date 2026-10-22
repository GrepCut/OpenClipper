/**
 * Shared contract for Open Clipper → GrepCut Studio ephemeral import.
 * Keep in sync with client/src/video-editor/features/clipper-import/types/clipper-studio-import.types.ts
 */

export const CLIPPER_STUDIO_IMPORT_VERSION = 2 as const;

export interface ClipperStudioNormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipperStudioImportSegment {
  startSec: number;
  endSec: number;
}

export interface ClipperStudioImportWord {
  text: string;
  start: number;
  end: number;
}

export interface ClipperStudioImportCaptionGroup {
  words: ClipperStudioImportWord[];
  start: number;
  end: number;
}

/** One drawn panel: `source` is normalized to the source frame, `destination` to the output frame. */
export interface ClipperStudioFramePanel {
  source: ClipperStudioNormalizedBox;
  destination: ClipperStudioNormalizedBox;
}

/** Exact frame geometry the Clipper preview renders at `t` (1 panel = crop, 2-3 = split). */
export interface ClipperStudioFrameSample {
  t: number;
  /** Hard cut / layout switch — do not interpolate into this sample. */
  cut?: true;
  panels: ClipperStudioFramePanel[];
}

export interface ClipperStudioImportCaption {
  enabled: boolean;
  presetId: string;
  wordsPerGroup: number;
  position?: "top" | "center" | "bottom";
  size?: "extra-small" | "small" | "medium" | "large";
}

export interface ClipperStudioImportThumbnails {
  indexFileName: string;
  packFileName?: string;
  intervalSec: number;
  height: number;
  count: number;
}

export interface ClipperStudioImport {
  version: typeof CLIPPER_STUDIO_IMPORT_VERSION;
  createdAt: string;
  formatId: string;
  aspectId: string;
  width: number;
  height: number;
  aspectRatio: number;
  sourceVideoFileName: string;
  manifestFileName: string;
  projectDataDir?: string;
  videoAbsolutePath?: string;
  manifestAbsolutePath?: string;
  totalDurationSec: number;
  segments: ClipperStudioImportSegment[];
  words: ClipperStudioImportWord[];
  captionGroups: ClipperStudioImportCaptionGroup[];
  caption: ClipperStudioImportCaption;
  frameTrack: ClipperStudioFrameSample[];
  thumbnails?: ClipperStudioImportThumbnails;
}
