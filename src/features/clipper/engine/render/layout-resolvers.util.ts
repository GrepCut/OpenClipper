import type { ClipperLayoutMode, ClipperLayoutSample, ClipperSmartCropBlob } from "../../shared/smart-crop.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import { interpolateLayoutSample, precedingIndex, resolveLayoutTrack } from "../autoflip/layout";
import { normalizedBoxToCropRect } from "../reframe";
import type { ResolvedClipperLayout } from "../types/render.types";

const MINIMUM_SPLIT_DURATION_SEC = 2;

function isShortSplitRun(samples: ClipperLayoutSample[], index: number): boolean {
  if (samples[index]?.mode !== "split") return false;
  let start = index;
  while (start > 0 && samples[start - 1]!.mode === "split" && !samples[start]!.cut) start--;
  let end = index + 1;
  while (end < samples.length && samples[end]!.mode === "split" && !samples[end]!.cut) end++;
  const endTime = end < samples.length ? samples[end]!.t : samples[end - 1]!.t;
  return endTime - samples[start]!.t < MINIMUM_SPLIT_DURATION_SEC;
}

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
  const suppressShortSplit = track != null && isShortSplitRun(track.samples, rawIndex);
  const renderedSample = suppressShortSplit
    ? {
        ...sample,
        mode: "single-crop" as const,
        viewports: sample.baselineViewports?.length ? sample.baselineViewports : [sample.viewports[0]!],
      }
    : sample;
  return {
    mode: renderedSample.mode,
    viewports: renderedSample.viewports.map((viewport) => normalizedBoxToCropRect(viewport, source)),
    solidBackgroundColor: renderedSample.solidBackgroundColor ?? blob.solidBackgroundColor,
    reasonCodes: suppressShortSplit
      ? [...(renderedSample.reasonCodes ?? []), "split-too-short"]
      : renderedSample.reasonCodes,
    requiredRegionIds: renderedSample.requiredRegionIds,
    subjectDisplayHeightFractions: renderedSample.qualityTelemetry?.subjectDisplayHeightFractions,
  };
}
