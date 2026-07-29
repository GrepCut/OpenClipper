import {
  DEFAULT_CAPTION_PRESET_ID,
  normalizeCaptionPresetId,
  type ClipperCaptionPresetId,
} from "../lib/captions/caption-presets.util";
import { clamp } from '../lib/math.util';

export type ClipperQualityPreset = "draft" | "standard" | "high";
export type ClipperResolutionCap = "source" | "1080p" | "720p";
export type ClipperCaptionPosition = "top" | "center" | "bottom";
export type ClipperCaptionSize = "small" | "medium" | "large";
export type ClipperTranscriptionEngine = "parakeet" | "whisper";
export type ClipperIsolateVocals = "off" | "on";

export interface ClipperCaptionSettings {
  enabled: boolean;
  presetId: ClipperCaptionPresetId;
  position: ClipperCaptionPosition;
  size: ClipperCaptionSize;
  wordsPerGroup: number;
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

export interface ClipperTranscriptionSettings {
  engine: ClipperTranscriptionEngine;
  /** Isolate vocals (MDX) before ASR — better for songs; default off for dialog. */
  isolateVocals: ClipperIsolateVocals;
}

export interface ClipperSettings {
  captions: ClipperCaptionSettings;
  formats: ClipperFormatSettings;
  audio: ClipperAudioSettings;
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
  captions: {
    enabled: true,
    presetId: DEFAULT_CAPTION_PRESET_ID,
    position: "bottom",
    size: "medium",
    wordsPerGroup: 4,
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
  transcription: {
    engine: "parakeet",
    isolateVocals: "off",
  },
  lastDurationPresetSec: 60,
};

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
  const partialCaptions = partial.captions as
    | Partial<ClipperCaptionSettings>
    | undefined;
  return {
    captions: {
      enabled:
        typeof partialCaptions?.enabled === "boolean"
          ? partialCaptions.enabled
          : base.captions.enabled,
      presetId: normalizeCaptionPresetId(
        partialCaptions?.presetId,
        base.captions.presetId,
      ),
      position:
        partialCaptions?.position === "top" ||
        partialCaptions?.position === "center" ||
        partialCaptions?.position === "bottom"
          ? partialCaptions.position
          : base.captions.position,
      size:
        partialCaptions?.size === "small" ||
        partialCaptions?.size === "medium" ||
        partialCaptions?.size === "large"
          ? partialCaptions.size
          : base.captions.size,
      wordsPerGroup:
        typeof partialCaptions?.wordsPerGroup === "number"
          ? clamp(Math.round(partialCaptions.wordsPerGroup), 1, 5)
          : base.captions.wordsPerGroup,
    },
    formats: { ...base.formats, ...partial.formats },
    audio: { ...base.audio, ...partial.audio },
    transcription: {
      engine: partial.transcription?.engine === "whisper" ? "whisper" : base.transcription.engine,
      isolateVocals:
        partial.transcription?.isolateVocals === "on" ||
        partial.transcription?.isolateVocals === "off"
          ? partial.transcription.isolateVocals
          : base.transcription.isolateVocals,
    },
    lastDurationPresetSec: partial.lastDurationPresetSec ?? base.lastDurationPresetSec,
  };
}
