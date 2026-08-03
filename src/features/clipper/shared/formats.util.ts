import { aspectRatioFromId, evenInt } from "../lib/media/video-draw.util";
import { CLIPPER_CARD_BADGE_INSET } from "../components/clipper-platform-icon.component";

export type ClipperPlatform = "instagram" | "tiktok" | "youtube" | "youtube-shorts" | "twitter";

/** Ids from `ASPECT_PRESETS` in `tools/shared/video-draw.ts`. */
export type ClipperAspectPresetId = "16-9" | "9-16" | "1-1" | "4-5";

export interface ClipperFormatDef {
  id: string;
  platform: ClipperPlatform;
  label: string;
  aspectId: ClipperAspectPresetId;
  /** Every format is cover-filled; Smart Follow supplies the source crop. */
  mode: "crop";
  description: string;
  isDefaultEnabled: boolean;
}

export const CLIPPER_FORMAT_DEFS: ClipperFormatDef[] = [
  {
    id: "youtube",
    platform: "youtube",
    label: "YouTube",
    aspectId: "16-9",
    mode: "crop",
    description: "Landscape 16:9 (cropped)",
    isDefaultEnabled: false,
  },
  {
    id: "instagram",
    platform: "instagram",
    label: "Instagram",
    aspectId: "1-1",
    mode: "crop",
    description: "Square 1:1",
    isDefaultEnabled: false,
  },
  {
    id: "tiktok",
    platform: "tiktok",
    label: "TikTok",
    aspectId: "9-16",
    mode: "crop",
    description: "Vertical 9:16",
    isDefaultEnabled: true,
  },
  {
    id: "youtube-shorts",
    platform: "youtube-shorts",
    label: "YouTube Shorts",
    aspectId: "9-16",
    mode: "crop",
    description: "Vertical 9:16",
    isDefaultEnabled: true,
  },
  {
    id: "instagram-portrait",
    platform: "instagram",
    label: "Instagram Portrait",
    aspectId: "4-5",
    mode: "crop",
    description: "Portrait 4:5",
    isDefaultEnabled: false,
  },
  {
    id: "twitter",
    platform: "twitter",
    label: "X / Twitter",
    aspectId: "16-9",
    mode: "crop",
    description: "Landscape 16:9 (cropped)",
    isDefaultEnabled: false,
  },
];

export function getClipperFormatDef(id: string): ClipperFormatDef | undefined {
  return CLIPPER_FORMAT_DEFS.find((f) => f.id === id);
}

/**
 * Fixed target resolution for a format preset — used both for the actual render
 * output size and for preview-card aspect sizing. All formats cover-fill it.
 */
export function canonicalFormatDims(def: ClipperFormatDef): { width: number; height: number } {
  const ratio = aspectRatioFromId(def.aspectId);
  const shortSide = 1080;
  if (ratio >= 1) {
    return { width: evenInt(shortSide * ratio), height: evenInt(shortSide) };
  }
  return { width: evenInt(shortSide), height: evenInt(shortSide / ratio) };
}

export const CLIPPER_CARD_FRAME_HEIGHT = 260;
/** Taller frame for the main preview pane in step 3. */
export const CLIPPER_HERO_PREVIEW_HEIGHT = 520;
/** Timeline footer below hero frame — mt-3 + VStack gap + slider track. */
export const CLIPPER_HERO_PREVIEW_TIMELINE_FOOTER_HEIGHT = 44;
/** Badge inset + hero frame + timeline footer — matches `ClipperFormatCard` hero layout. */
export const CLIPPER_HERO_PREVIEW_PANE_HEIGHT =
  CLIPPER_HERO_PREVIEW_HEIGHT + CLIPPER_HERO_PREVIEW_TIMELINE_FOOTER_HEIGHT;
/** Full hero preview column height (badge through timeline) for clips-panel alignment. */
export const CLIPPER_HERO_PREVIEW_COLUMN_HEIGHT =
  CLIPPER_CARD_BADGE_INSET + CLIPPER_HERO_PREVIEW_PANE_HEIGHT;

export function getClipperCardFrameSize(
  formatId: string,
  height = CLIPPER_CARD_FRAME_HEIGHT,
): { width: number; height: number } {
  const def = getClipperFormatDef(formatId);
  if (!def) return { width: height, height };
  const { width: refW, height: refH } = canonicalFormatDims(def);
  const ratio = refW / refH;
  return { width: Math.round(height * ratio), height };
}
