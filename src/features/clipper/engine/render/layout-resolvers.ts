import type { ClipperLayoutMode, ClipperSmartCropBlob } from "../../shared/smart-crop";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect";
import { interpolateLayoutSample, resolveLayoutTrack } from "../autoflip/layout";
import { normalizedBoxToCropRect, type ClipperCropRect } from "../reframe";

export interface ResolvedClipperLayout {
  mode: ClipperLayoutMode;
  viewports: ClipperCropRect[];
  solidBackgroundColor?: { r: number; g: number; b: number };
  reasonCodes?: string[];
  requiredRegionIds?: string[];
  subjectDisplayHeightFractions?: number[];
}

/** Resolves a v3 editing decision; absent on persisted legacy analyses. */
export function resolveClipperLayoutRender(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): ResolvedClipperLayout | undefined {
  if (!blob) return undefined;
  const sample = interpolateLayoutSample(resolveLayoutTrack(blob.layoutTracks, formatId), time);
  if (!sample?.viewports.length) return undefined;
  return {
    mode: sample.mode,
    viewports: sample.viewports.map((viewport) => normalizedBoxToCropRect(viewport, source)),
    solidBackgroundColor: sample.solidBackgroundColor ?? blob.solidBackgroundColor,
    reasonCodes: sample.reasonCodes,
    requiredRegionIds: sample.requiredRegionIds,
    subjectDisplayHeightFractions: sample.qualityTelemetry?.subjectDisplayHeightFractions,
  };
}
