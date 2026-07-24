import type { AutoFlipAspectTrack, ClipperSmartCropBlob, NormalizedBox } from "../../shared/smart-crop.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import { resolveAutoFlipCropTrack } from "../autoflip/build-track.util";
import { interpolateCameraBox } from "../autoflip/camera/trajectory-interpolation.util";
import { normalizedBoxToCropRect } from "../reframe";
import type { ClipperCropRect } from "../types/reframe.types";

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
  return {
    crop: interpolateCameraBox({ t: previous.t, box: previous.crop }, { t: next.t, box: next.crop }, time),
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
