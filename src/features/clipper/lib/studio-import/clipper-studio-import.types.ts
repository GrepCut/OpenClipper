export const CLIPPER_STUDIO_IMPORT_VERSION = 1 as const;

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

export interface ClipperStudioCropSample {
  t: number;
  crop: ClipperStudioNormalizedBox;
  cut?: boolean;
}

export interface ClipperStudioImportCaption {
  enabled: boolean;
  presetId: string;
  wordsPerGroup: number;
  position?: "top" | "center" | "bottom";
  size?: "small" | "medium" | "large";
}

export interface ClipperStudioImportThumbnails {
  indexFileName: string;
  packFileName?: string;
  intervalSec: number;
  height: number;
  count: number;
}

export interface ClipperStudioImportV1 {
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
  cropTrack: ClipperStudioCropSample[];
  contentRect?: ClipperStudioNormalizedBox;
  solidBackgroundColor?: { r: number; g: number; b: number };
  thumbnails?: ClipperStudioImportThumbnails;
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
