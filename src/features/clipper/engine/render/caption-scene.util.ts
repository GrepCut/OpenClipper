import {
  resolveCaptionPreset,
  type CaptionPresetDefinition,
  type CaptionRendererKind,
} from "../../lib/captions/caption-presets.util";
import type { CaptionGroup } from "../../lib/media/transcription-export.util";
import type { ClipperCaptionSettings } from "../../settings/settings.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";

export interface CaptionSceneWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionSceneGroup {
  start: number;
  end: number;
  words: CaptionSceneWord[];
}

export interface CaptionScene {
  outputWidth: number;
  outputHeight: number;
  fps: number;
  presetId: string;
  fontFamily: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fontSizeRatio: number;
  lineHeightRatio: number;
  wordGapEm: number;
  letterSpacingEm: number;
  uppercase: boolean;
  maxWidthRatio: number;
  anchorY: number;
  textColor: string;
  activeTextColor: string;
  activeColor: string;
  outlineColor: string;
  outlineWidthEm: number;
  shadowColor: string;
  shadowBlurEm: number;
  shadowOffsetXEm: number;
  shadowOffsetYEm: number;
  plateStyle: "none" | "group";
  plateColor: string;
  plateOpacity: number;
  plateRadiusEm: number;
  platePaddingXEm: number;
  platePaddingYEm: number;
  activeEffect: CaptionPresetDefinition["activeEffect"];
  activeGradient?: { from: string; to: string };
  activePaddingXEm: number;
  activePaddingYEm: number;
  activeRadiusEm: number;
  activeTransitionSec: number;
  activeScale: number;
  activeRotationDeg: number;
  entrance: CaptionPresetDefinition["entrance"];
  entranceDurationSec: number;
  entranceScaleFrom: number;
  entranceBlurEm: number;
  inactiveOpacity: number;
  activeOutlineWidthEm?: number;
  groupScaleTo?: number;
  secondaryFontFamily?: string;
  secondaryFontSizeScale?: number;
  accentColors?: string[];
  renderer: CaptionRendererKind;
  groups: CaptionSceneGroup[];
}

const POSITION_ANCHOR_Y: Record<ClipperCaptionSettings["position"], number> = {
  top: 0.22,
  center: 0.5,
  bottom: 0.78,
};

const SIZE_SCALE: Record<ClipperCaptionSettings["size"], number> = {
  small: 0.8,
  medium: 1,
  large: 1.24,
};

/** Renderers supported by the native GPU caption path (klyff). */
export const GPU_CAPTION_RENDERERS: ReadonlySet<CaptionRendererKind> = new Set([
  "phrase",
  "one-word",
  "karaoke",
  "kinetic",
  "podcast",
]);

export function isGpuCaptionRenderer(renderer: CaptionRendererKind): boolean {
  return GPU_CAPTION_RENDERERS.has(renderer);
}

function presetToSceneFields(
  preset: CaptionPresetDefinition,
  captions: ClipperCaptionSettings,
  output: FrameEffectSize,
): Omit<CaptionScene, "groups" | "fps" | "outputWidth" | "outputHeight"> {
  const sizeScale = SIZE_SCALE[captions.size];
  const anchorY = POSITION_ANCHOR_Y[captions.position];
  return {
    presetId: preset.id,
    fontFamily: preset.fontFamily,
    fontWeight: preset.fontWeight,
    fontStyle: preset.fontStyle,
    fontSizeRatio: preset.fontSizeRatio * sizeScale,
    lineHeightRatio: preset.lineHeightRatio,
    wordGapEm: preset.wordGapEm,
    letterSpacingEm: preset.letterSpacingEm,
    uppercase: preset.uppercase,
    maxWidthRatio: preset.maxWidthRatio,
    anchorY,
    textColor: preset.textColor,
    activeTextColor: preset.activeTextColor,
    activeColor: preset.activeColor,
    outlineColor: preset.outlineColor,
    outlineWidthEm: preset.outlineWidthEm,
    shadowColor: preset.shadowColor,
    shadowBlurEm: preset.shadowBlurEm,
    shadowOffsetXEm: preset.shadowOffsetXEm,
    shadowOffsetYEm: preset.shadowOffsetYEm,
    plateStyle: preset.plateStyle,
    plateColor: preset.plateColor,
    plateOpacity: preset.plateOpacity,
    plateRadiusEm: preset.plateRadiusEm,
    platePaddingXEm: preset.platePaddingXEm,
    platePaddingYEm: preset.platePaddingYEm,
    activeEffect: preset.activeEffect,
    activeGradient: preset.activeGradient
      ? { from: preset.activeGradient.from, to: preset.activeGradient.to }
      : undefined,
    activePaddingXEm: preset.activePaddingXEm,
    activePaddingYEm: preset.activePaddingYEm,
    activeRadiusEm: preset.activeRadiusEm,
    activeTransitionSec: preset.activeTransitionSec,
    activeScale: preset.activeScale,
    activeRotationDeg: preset.activeRotationDeg,
    entrance: preset.entrance,
    entranceDurationSec: preset.entranceDurationSec,
    entranceScaleFrom: preset.entranceScaleFrom,
    entranceBlurEm: preset.entranceBlurEm,
    inactiveOpacity: preset.inactiveOpacity ?? 1,
    activeOutlineWidthEm: preset.activeOutlineWidthEm,
    groupScaleTo: preset.groupScaleTo,
    secondaryFontFamily: preset.secondaryFontFamily,
    secondaryFontSizeScale: preset.secondaryFontSizeScale,
    accentColors: preset.accentColors ? [...preset.accentColors] : undefined,
    renderer: preset.renderer,
  };
}

export function buildCaptionScene(
  groups: CaptionGroup[],
  output: FrameEffectSize,
  captions: ClipperCaptionSettings,
  fps = 30,
): CaptionScene {
  const preset = resolveCaptionPreset(captions.presetId);
  return {
    outputWidth: output.width,
    outputHeight: output.height,
    fps,
    groups: groups.map((group) => ({
      start: group.start,
      end: group.end,
      words: group.words.map((word) => ({
        text: word.text,
        start: word.start,
        end: word.end,
      })),
    })),
    ...presetToSceneFields(preset, captions, output),
  };
}
