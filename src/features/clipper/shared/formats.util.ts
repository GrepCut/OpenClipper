import { aspectRatioFromId, evenInt } from "../lib/media/video-draw.util";
import { CLIPPER_CARD_BADGE_INSET } from "../components/clipper-platform-icon.component";
import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";

export type ClipperPlatform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "youtube-shorts"
  | "twitter"
  | "threads"
  | "facebook";

/** Ids from `ASPECT_PRESETS` in `tools/shared/video-draw.ts`. */
export type ClipperAspectPresetId = "16-9" | "9-16" | "1-1" | "4-5";

export interface ClipperFormatDef {
  id: string;
  /** Primary platform key used for legacy lookups and single-icon fallback. */
  platform: ClipperPlatform;
  /** Platforms shown on the format badge (dual-icon when length > 1). */
  badgePlatforms?: ClipperPlatform[];
  /** Publish targets for this export; when omitted, derived from `platform`. */
  publishTargets?: SocialPublishablePlatform[];
  label: string;
  aspectId: ClipperAspectPresetId;
  /** Every format is cover-filled; Smart Follow supplies the source crop. */
  mode: "crop";
  description: string;
  isDefaultEnabled: boolean;
}

/** Legacy format ids remapped onto the shared vertical-short preset. */
export const LEGACY_VERTICAL_SHORT_FORMAT_IDS = ["tiktok", "youtube-shorts"] as const;

export const CLIPPER_FORMAT_DEFS: ClipperFormatDef[] = [
  {
    id: "youtube",
    platform: "youtube",
    badgePlatforms: ["youtube"],
    publishTargets: ["youtube", "facebook"],
    label: "YouTube",
    aspectId: "16-9",
    mode: "crop",
    description: "Landscape 16:9 (cropped)",
    isDefaultEnabled: false,
  },
  {
    id: "instagram",
    platform: "instagram",
    badgePlatforms: ["instagram"],
    publishTargets: ["instagram"],
    label: "Instagram",
    aspectId: "1-1",
    mode: "crop",
    description: "Square 1:1",
    isDefaultEnabled: false,
  },
  {
    id: "vertical-short",
    platform: "tiktok",
    badgePlatforms: ["tiktok", "youtube-shorts"],
    publishTargets: ["tiktok", "youtube"],
    label: "TikTok / YouTube Shorts",
    aspectId: "9-16",
    mode: "crop",
    description: "Vertical 9:16 — one export for TikTok and YouTube Shorts",
    isDefaultEnabled: true,
  },
  {
    id: "vertical-reels",
    platform: "instagram",
    badgePlatforms: ["instagram", "threads", "facebook"],
    publishTargets: ["instagram", "threads", "facebook"],
    label: "Instagram Reels / Threads / Facebook",
    aspectId: "9-16",
    mode: "crop",
    description: "Vertical 9:16 — one export for Reels, Threads, and Facebook",
    isDefaultEnabled: true,
  },
  {
    id: "instagram-portrait",
    platform: "instagram",
    badgePlatforms: ["instagram", "facebook"],
    publishTargets: ["instagram", "facebook"],
    label: "Instagram / Facebook Portrait",
    aspectId: "4-5",
    mode: "crop",
    description: "Portrait 4:5 — one export for Instagram and Facebook",
    isDefaultEnabled: true,
  },
  {
    id: "twitter",
    platform: "twitter",
    badgePlatforms: ["twitter"],
    publishTargets: ["x"],
    label: "X / Twitter",
    aspectId: "16-9",
    mode: "crop",
    description: "Landscape 16:9 (cropped)",
    isDefaultEnabled: false,
  },
];

const LEGACY_FORMAT_ID_MAP: Record<string, string> = {
  tiktok: "vertical-short",
  "youtube-shorts": "vertical-short",
};

/** Map a stored format id (including legacy aliases) onto a current definition id. */
export function normalizeLegacyFormatId(id: string): string {
  return LEGACY_FORMAT_ID_MAP[id] ?? id;
}

/**
 * Normalize enabled format ids after settings load: remap aliases and dedupe.
 * Preserves first-seen order of the canonical ids.
 */
export function migrateEnabledFormatIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const next = normalizeLegacyFormatId(id);
    if (seen.has(next)) continue;
    if (!CLIPPER_FORMAT_DEFS.some((def) => def.id === next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/** Default export formats for new projects / render queue (from format defs). */
export function getDefaultEnabledFormatIds(): string[] {
  return CLIPPER_FORMAT_DEFS.filter((def) => def.isDefaultEnabled).map((def) => def.id);
}

export function getClipperFormatDef(id: string): ClipperFormatDef | undefined {
  const canonical = normalizeLegacyFormatId(id);
  return CLIPPER_FORMAT_DEFS.find((f) => f.id === canonical);
}

/** Publish targets for a format (canonical or legacy id). */
export function getPublishTargetsForFormat(formatId: string): SocialPublishablePlatform[] {
  const def = getClipperFormatDef(formatId);
  if (!def) return [];
  if (def.publishTargets?.length) return def.publishTargets;
  // Fallback for defs without explicit targets
  switch (def.platform) {
    case "twitter":
      return ["x"];
    case "youtube-shorts":
      return ["youtube"];
    case "threads":
      return ["threads"];
    case "facebook":
      return ["facebook"];
    case "instagram":
      return ["instagram"];
    case "tiktok":
      return ["tiktok"];
    case "youtube":
      return ["youtube"];
    default:
      return [];
  }
}

export function getBadgePlatformsForFormat(formatId: string): ClipperPlatform[] {
  const def = getClipperFormatDef(formatId);
  if (!def) return [];
  if (def.badgePlatforms?.length) return def.badgePlatforms;
  return [def.platform];
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
