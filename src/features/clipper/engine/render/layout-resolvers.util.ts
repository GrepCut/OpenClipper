import type { ClipperLayoutMode, ClipperSmartCropBlob } from "../../shared/smart-crop.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import { interpolateLayoutSample, precedingIndex, resolveLayoutTrack } from "../autoflip/layout";
import { normalizedBoxToCropRect } from "../reframe";
import type { ResolvedClipperLayout } from "../types/render.types";

/** Resolves a v3 editing decision; absent on persisted legacy analyses. */
export function resolveClipperLayoutRender(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): ResolvedClipperLayout | undefined {
  if (!blob) return undefined;
  const track = resolveLayoutTrack(blob.layoutTracks, formatId);
  const sample = interpolateLayoutSample(track, time);
  if (!sample?.viewports.length) return undefined;
  const rawIndex = track ? precedingIndex(track.samples.map((item) => ({ time: item.t })), time) : 0;
  const raw = track?.samples[rawIndex];
  const previous = rawIndex > 0 ? track?.samples[rawIndex - 1] : undefined;
  const changedLayout = raw != null && previous != null && !raw.cut
    && (raw.mode !== previous.mode || raw.viewports.length !== previous.viewports.length);
  const elapsed = raw ? time - raw.t : Number.POSITIVE_INFINITY;
  const transitionProgress = changedLayout && elapsed >= 0 && elapsed < 0.2 ? elapsed / 0.2 : undefined;
  return {
    mode: sample.mode,
    viewports: sample.viewports.map((viewport) => normalizedBoxToCropRect(viewport, source)),
    solidBackgroundColor: sample.solidBackgroundColor ?? blob.solidBackgroundColor,
    reasonCodes: sample.reasonCodes,
    requiredRegionIds: sample.requiredRegionIds,
    subjectDisplayHeightFractions: sample.qualityTelemetry?.subjectDisplayHeightFractions,
    transitionFrom: transitionProgress == null || !previous ? undefined : {
      mode: previous.mode,
      viewports: previous.viewports.map((viewport) => normalizedBoxToCropRect(viewport, source)),
      solidBackgroundColor: previous.solidBackgroundColor ?? blob.solidBackgroundColor,
    },
    transitionProgress,
  };
}
