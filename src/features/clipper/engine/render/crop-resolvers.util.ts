import type { ClipperFormatDef } from "../../shared/formats.util";
import type { AutoFlipAspectTrack, ClipperSmartCropBlob, NormalizedBox } from "../../shared/smart-crop.util";
import type { ClipperSettings } from "../../settings/settings.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import { resolveAutoFlipCropTrack } from "../autoflip/build-track.util";
import {
  cropRectForCentroid,
  interpolateCentroid,
  normalizedBoxToCropRect,
} from "../reframe";
import type { CentroidSample, ClipperCropRect } from "../types/reframe.types";

export function resolveCropRect(
  formatDef: ClipperFormatDef,
  source: FrameEffectSize,
  output: FrameEffectSize,
  t: number,
  settings: ClipperSettings,
  focusTrack: CentroidSample[] | null,
): ClipperCropRect | undefined {
  if (formatDef.mode !== "crop") return undefined;
  const targetRatio = output.width / output.height;
  const { cropMode, headroom, manualFocalPoint } = settings.reframe;

  if (cropMode === "manual") {
    return cropRectForCentroid(source.width, source.height, manualFocalPoint.x, manualFocalPoint.y, targetRatio, headroom);
  }
  if (
    (cropMode === "center" || cropMode === "smart-follow" || cropMode === "face-follow" || cropMode === "podcast-collage") &&
    focusTrack &&
    focusTrack.length > 0
  ) {
    const c = interpolateCentroid(focusTrack, t);
    return cropRectForCentroid(source.width, source.height, c.x, c.y, targetRatio, headroom, c.extent);
  }
  return undefined;
}

function interpolateAutoFlipCrop(track: AutoFlipAspectTrack, time: number): { crop: NormalizedBox; solidBackgroundColor?: { r: number; g: number; b: number } } | null {
  const samples = track.samples;
  if (!samples.length) return null;
  if (time <= samples[0]!.t) return { crop: samples[0]!.crop, solidBackgroundColor: samples[0]!.solidBackgroundColor };
  const last = samples.at(-1)!;
  if (time >= last.t) return { crop: last.crop, solidBackgroundColor: last.solidBackgroundColor };
  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (samples[middle]!.t < time) low = middle + 1;
    else high = middle;
  }
  const next = samples[low]!;
  const previous = samples[low - 1]!;
  if (next.cut) return { crop: previous.crop, solidBackgroundColor: previous.solidBackgroundColor };
  const factor = (time - previous.t) / Math.max(Number.EPSILON, next.t - previous.t);
  return {
    crop: {
      x: previous.crop.x + (next.crop.x - previous.crop.x) * factor,
      y: previous.crop.y + (next.crop.y - previous.crop.y) * factor,
      width: previous.crop.width + (next.crop.width - previous.crop.width) * factor,
      height: previous.crop.height + (next.crop.height - previous.crop.height) * factor,
    },
    solidBackgroundColor: previous.solidBackgroundColor,
  };
}

/** Converts the normalized crop emitted by AutoFlip into source pixels. */
export function resolveAutoFlipCropRect(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): ClipperCropRect | undefined {
  return resolveAutoFlipCropRender(blob, formatId, source, time)?.cropRect;
}

export function resolveAutoFlipCropRender(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): { cropRect: ClipperCropRect; solidBackgroundColor?: { r: number; g: number; b: number } } | undefined {
  if (!blob) return undefined;
  const resolved = interpolateAutoFlipCrop(resolveAutoFlipCropTrack(blob, formatId) ?? { targetAspectRatio: 1, samples: [] }, time);
  if (!resolved) return undefined;
  return {
    cropRect: normalizedBoxToCropRect(resolved.crop, source),
    solidBackgroundColor: resolved.solidBackgroundColor ?? blob.solidBackgroundColor,
  };
}
