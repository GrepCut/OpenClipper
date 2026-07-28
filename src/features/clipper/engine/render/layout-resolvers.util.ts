import {
  isClipperRuntimeSmartCropBlob,
  type ClipperFrameAnalysis,
  type ClipperLayoutTrack,
} from "../../shared/smart-crop.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import { getClipperFormatDef } from "../../shared/formats.util";
import {
  interpolateLayoutSample,
  isShortCandidateSplitRun,
  isShortSelectedSplitRun,
  precedingLayoutSampleIndex,
  resolveLayoutTrack,
  restoreShortSplitCandidate,
  shouldKeepShortSplitRun,
  withShortSplitConfidenceReason,
} from "../autoflip/layout";
import { normalizedBoxToCropRect } from "../reframe";
import type { ResolvedClipperLayout } from "../types/render.types";

/** Resolves a v3 editing decision; absent on persisted legacy analyses. */
export function resolveClipperLayoutRender(
  blob: ClipperFrameAnalysis | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): ResolvedClipperLayout | undefined {
  if (!blob) return undefined;
  if (isClipperRuntimeSmartCropBlob(blob)) {
    const aspectId = getClipperFormatDef(formatId)?.aspectId;
    const runtimeTrack = (aspectId ? blob.layoutTracks[aspectId] : undefined)
      ?? blob.layoutTracks[formatId]
      ?? blob.layoutTracks.default;
    if (!runtimeTrack?.samples.length) return undefined;
    // The interpolation helper only reads the compact fields when diagnostics
    // are absent; casting preserves its battle-tested cut/panel-owner rules.
    const sample = interpolateLayoutSample(runtimeTrack as unknown as ClipperLayoutTrack, time);
    if (!sample?.viewports.length) return undefined;
    return {
      mode: sample.mode,
      viewports: sample.viewports.map((viewport) => normalizedBoxToCropRect(viewport, source)),
      solidBackgroundColor: sample.solidBackgroundColor ?? blob.solidBackgroundColor,
    };
  }
  const track = resolveLayoutTrack(blob.layoutTracks, formatId);
  const sample = interpolateLayoutSample(track, time);
  if (!sample?.viewports.length) return undefined;
  const rawIndex = track ? precedingLayoutSampleIndex(track.samples, time) : 0;
  const rawSample = track?.samples[rawIndex];
  const selectedShortSplit = track != null && isShortSelectedSplitRun(track.samples, rawIndex);
  const keepSelectedSplit = selectedShortSplit && shouldKeepShortSplitRun(track!.samples, rawIndex);
  const restorePersistedCandidate = track != null
    && rawSample?.mode !== "split"
    && isShortCandidateSplitRun(track.samples, rawIndex)
    && shouldKeepShortSplitRun(track.samples, rawIndex);
  const renderedSample = restorePersistedCandidate
    ? restoreShortSplitCandidate(sample) ?? sample
    : selectedShortSplit && keepSelectedSplit
      ? withShortSplitConfidenceReason(sample)
      : selectedShortSplit
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
    reasonCodes: selectedShortSplit && !keepSelectedSplit
      ? [...(renderedSample.reasonCodes ?? []), "split-too-short"]
      : renderedSample.reasonCodes,
    requiredRegionIds: renderedSample.requiredRegionIds,
    subjectDisplayHeightFractions: renderedSample.qualityTelemetry?.subjectDisplayHeightFractions,
  };
}
