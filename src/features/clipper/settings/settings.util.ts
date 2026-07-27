import type {
  SubtitleFontFamily,
  SubtitleFontSize,
  SubtitlePosition,
} from '../lib/captions/subtitle-render.util';
import { clamp } from '../lib/math.util';

export type ClipperCaptionBoxStyle = "solid" | "outline" | "none";

export type ClipperQualityPreset = "draft" | "standard" | "high";
export type ClipperResolutionCap = "source" | "1080p" | "720p";

export interface ClipperCaptionSettings {
  enabled: boolean;
  fontFamily: SubtitleFontFamily;
  fontSize: SubtitleFontSize;
  position: SubtitlePosition;
  wordsPerGroup: number;
  highlightColor: string;
  wrap: boolean;
  uppercase: boolean;
  boxStyle: ClipperCaptionBoxStyle;
  boxOpacity: number;
  /** Format ids where captions are force-disabled, overriding `enabled`. */
  disabledForFormatIds: string[];
}

export interface ClipperFormatSettings {
  enabledFormatIds: string[];
  quality: ClipperQualityPreset;
  resolutionCap: ClipperResolutionCap;
  /** May reference {name} and {platform}. */
  filenameTemplate: string;
}

export interface ClipperAudioSettings {
  mute: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  normalize: boolean;
  normalizePreset: string;
  peakCeiling: number;
}

export interface ClipperSettings {
  captions: ClipperCaptionSettings;
  formats: ClipperFormatSettings;
  audio: ClipperAudioSettings;
  /** Last duration preset picked on the trim-select stage, remembered across uploads. */
  lastDurationPresetSec: number;
}

export const CLIPPER_DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "45s", seconds: 45 },
  { label: "60s", seconds: 60 },
  { label: "90s", seconds: 90 },
  { label: "3min", seconds: 180 },
];

export const CLIPPER_MIN_CLIP_SECONDS = 3;

export const DEFAULT_CLIPPER_SETTINGS: ClipperSettings = {
  captions: {
    enabled: true,
    fontFamily: "arial",
    fontSize: "md",
    position: "bottom",
    wordsPerGroup: 5,
    highlightColor: "#FFE566",
    wrap: true,
    uppercase: false,
    boxStyle: "solid",
    boxOpacity: 0.55,
    disabledForFormatIds: [],
  },
  formats: {
    enabledFormatIds: ["tiktok"],
    quality: "standard",
    resolutionCap: "source",
    filenameTemplate: "{name}-clip-{clip}-{platform}",
  },
  audio: {
    mute: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    normalize: false,
    normalizePreset: "streaming",
    peakCeiling: -1,
  },
  lastDurationPresetSec: 60,
};

export function clampOpacity01(value: number): number {
  return clamp(value, 0, 1);
}

export function clampWordsPerGroup(value: number): number {
  return Math.round(clamp(value, 1, 12));
}

export function clampFadeSeconds(value: number): number {
  return clamp(value, 0, 10);
}

export function clampPeakCeiling(value: number): number {
  return clamp(value, -6, 0);
}

export function clampDurationSeconds(value: number, sourceDuration: number): number {
  return clamp(value, CLIPPER_MIN_CLIP_SECONDS, Math.max(CLIPPER_MIN_CLIP_SECONDS, sourceDuration));
}

/** Shallow-per-group merge so a partial/older stored shape can't crash on new fields. */
export function mergeClipperSettings(
  base: ClipperSettings,
  partial: Partial<ClipperSettings> | null | undefined,
): ClipperSettings {
  if (!partial) return base;
  return {
    captions: { ...base.captions, ...partial.captions },
    formats: { ...base.formats, ...partial.formats },
    audio: { ...base.audio, ...partial.audio },
    lastDurationPresetSec: partial.lastDurationPresetSec ?? base.lastDurationPresetSec,
  };
}
