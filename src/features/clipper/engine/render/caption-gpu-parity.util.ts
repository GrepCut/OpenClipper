import { drawPhraseAnimatedCaption } from "../../lib/captions/animated-caption-render.util";
import {
  CLIPPER_CAPTION_PRESET_IDS,
  resolveCaptionPreset,
  type ClipperCaptionPresetId,
} from "../../lib/captions/caption-presets.util";
import type { CaptionGroup } from "../../lib/media/transcription-export.util";
import type { ClipperCaptionSettings } from "../../settings/settings.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import { buildCaptionScene } from "./caption-scene.util";

export interface CaptionParitySample {
  presetId: ClipperCaptionPresetId;
  timestamp: number;
  width: number;
  height: number;
  groups: CaptionGroup[];
  captions: ClipperCaptionSettings;
}

export interface CaptionParityMetrics {
  presetId: ClipperCaptionPresetId;
  timestamp: number;
  mae: number;
  nonTransparentPixels: number;
  comparedPixels: number;
}

/** Mean absolute error on RGB channels for pixels where either buffer has alpha > 8. */
export function compareCaptionRgba(
  canvasRgba: Uint8ClampedArray,
  gpuRgba: Uint8ClampedArray,
  width: number,
  height: number,
): { mae: number; comparedPixels: number; nonTransparentPixels: number } {
  const pixels = width * height;
  if (canvasRgba.length < pixels * 4 || gpuRgba.length < pixels * 4) {
    throw new Error("RGBA buffer size mismatch");
  }
  let sum = 0;
  let compared = 0;
  let visible = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const ca = canvasRgba[o + 3]!;
    const ga = gpuRgba[o + 3]!;
    if (ca > 8 || ga > 8) {
      compared += 1;
      sum +=
        Math.abs(canvasRgba[o]! - gpuRgba[o]!) +
        Math.abs(canvasRgba[o + 1]! - gpuRgba[o + 1]!) +
        Math.abs(canvasRgba[o + 2]! - gpuRgba[o + 2]!);
    }
    if (ca > 8) visible += 1;
  }
  return {
    mae: compared > 0 ? sum / (compared * 3) : 0,
    comparedPixels: compared,
    nonTransparentPixels: visible,
  };
}

export function renderCanvasCaptionRgba(
  sample: CaptionParitySample,
): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(sample.width, sample.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.clearRect(0, 0, sample.width, sample.height);
  drawPhraseAnimatedCaption(
    ctx,
    sample.groups,
    sample.timestamp,
    sample.width,
    sample.height,
    sample.presetId,
  );
  return ctx.getImageData(0, 0, sample.width, sample.height).data;
}

export function buildParityCaptionScene(sample: CaptionParitySample) {
  const output: FrameEffectSize = {
    width: sample.width,
    height: sample.height,
  };
  return buildCaptionScene(sample.groups, output, sample.captions, 30);
}

/** Phrase presets used for export parity sampling. */
export const PHRASE_PARITY_PRESET_IDS = CLIPPER_CAPTION_PRESET_IDS.filter(
  (id) => resolveCaptionPreset(id).renderer === "phrase",
);

export function makeParitySample(
  presetId: ClipperCaptionPresetId,
  groups: CaptionGroup[],
  output: FrameEffectSize,
  captions: ClipperCaptionSettings,
  timestamp = 0.35,
): CaptionParitySample {
  return {
    presetId,
    timestamp,
    width: output.width,
    height: output.height,
    groups,
    captions: { ...captions, presetId },
  };
}

export function evaluateParityMetrics(
  sample: CaptionParitySample,
  gpuRgba: Uint8ClampedArray,
): CaptionParityMetrics {
  const canvasRgba = renderCanvasCaptionRgba(sample);
  const { mae, comparedPixels, nonTransparentPixels } = compareCaptionRgba(
    canvasRgba,
    gpuRgba,
    sample.width,
    sample.height,
  );
  return {
    presetId: sample.presetId,
    timestamp: sample.timestamp,
    mae,
    comparedPixels,
    nonTransparentPixels,
  };
}
