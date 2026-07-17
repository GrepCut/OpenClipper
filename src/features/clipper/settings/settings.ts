import type {
  SubtitleFontFamily,
  SubtitleFontSize,
  SubtitlePosition,
} from '../lib/captions/subtitle-render';

export type ClipperCropMode = "center" | "smart-follow" | "face-follow" | "podcast-collage" | "manual";
export type ClipperFacePickStrategy = "largest" | "centered";
export type ClipperSmoothingStrength = "smooth" | "balanced" | "snappy";
export type ClipperHeadroom = "tight" | "normal" | "wide";

export type ClipperCaptionBoxStyle = "solid" | "outline" | "none";

export type ClipperQualityPreset = "draft" | "standard" | "high";
export type ClipperResolutionCap = "source" | "1080p" | "720p";

export type ClipperWatermarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface ClipperReframeSettings {
  cropMode: ClipperCropMode;
  facePickStrategy: ClipperFacePickStrategy;
  smoothing: ClipperSmoothingStrength;
  headroom: ClipperHeadroom;
  /** 0..1 normalized, used only when cropMode === "manual". */
  manualFocalPoint: { x: number; y: number };
  showDebugFaceBoxes: boolean;
}

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

export interface ClipperBrandingSettings {
  watermarkDataUrl: string | null;
  watermarkCorner: ClipperWatermarkCorner;
  watermarkScale: number;
  watermarkOpacity: number;
  introText: string;
  introSeconds: number;
  outroText: string;
  outroSeconds: number;
  showProgressBar: boolean;
}

export type ClipperTranscriptionEngine = "api" | "parakeet_local";

export interface ClipperTranscriptionSettings {
  engine: ClipperTranscriptionEngine;
}

export interface ClipperSettings {
  reframe: ClipperReframeSettings;
  captions: ClipperCaptionSettings;
  formats: ClipperFormatSettings;
  audio: ClipperAudioSettings;
  branding: ClipperBrandingSettings;
  transcription: ClipperTranscriptionSettings;
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
  reframe: {
    cropMode: "smart-follow",
    facePickStrategy: "largest",
    // "snappy" is the immediate/precise default — the crop should already be
    // centered on the speaker, not visibly panning to find them.
    smoothing: "snappy",
    headroom: "normal",
    manualFocalPoint: { x: 0.5, y: 0.5 },
    showDebugFaceBoxes: false,
  },
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
  branding: {
    watermarkDataUrl: null,
    watermarkCorner: "bottom-right",
    watermarkScale: 0.16,
    watermarkOpacity: 0.85,
    introText: "",
    introSeconds: 2,
    outroText: "",
    outroSeconds: 2,
    showProgressBar: false,
  },
  transcription: {
    engine: "api",
  },
  lastDurationPresetSec: 60,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampOpacity01(value: number): number {
  return clamp(value, 0, 1);
}

export function clampWordsPerGroup(value: number): number {
  return Math.round(clamp(value, 1, 12));
}

export function clampFadeSeconds(value: number): number {
  return clamp(value, 0, 10);
}

export function clampOverlaySeconds(value: number): number {
  return clamp(value, 0, 10);
}

export function clampWatermarkScale(value: number): number {
  return clamp(value, 0.05, 0.4);
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
  const reframe = { ...base.reframe, ...partial.reframe };
  if (reframe.cropMode === "podcast-collage") reframe.cropMode = "smart-follow";
  return {
    reframe,
    captions: { ...base.captions, ...partial.captions },
    formats: { ...base.formats, ...partial.formats },
    audio: { ...base.audio, ...partial.audio },
    branding: { ...base.branding, ...partial.branding },
    transcription: { ...base.transcription, ...partial.transcription },
    lastDurationPresetSec: partial.lastDurationPresetSec ?? base.lastDurationPresetSec,
  };
}
