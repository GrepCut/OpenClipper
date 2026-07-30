import {
  isShortCandidateSplitRun,
  isShortSelectedSplitRun,
  restoreShortSplitCandidate,
  shouldKeepShortSplitRun,
} from "../autoflip/layout";
import type {
  ClipperLayoutSample,
  ClipperLayoutTrack,
  ClipperRuntimeLayoutSample,
  ClipperRuntimeSmartCropBlob,
  ClipperSmartCropBlob,
} from "../../shared/smart-crop.util";

const FORMAT_ASPECTS = [
  ["youtube", "16-9"],
  ["instagram", "1-1"],
  ["tiktok", "9-16"],
  ["instagram-portrait", "4-5"],
  ["twitter", "16-9"],
] as const;

function finalSample(samples: ClipperLayoutSample[], index: number): ClipperLayoutSample {
  const sample = samples[index]!;
  if (sample.mode === "split" && isShortSelectedSplitRun(samples, index) && !shouldKeepShortSplitRun(samples, index)) {
    return {
      ...sample,
      mode: "single-crop",
      viewports: sample.baselineViewports?.length ? sample.baselineViewports : [sample.viewports[0]!],
    };
  }
  if (
    sample.mode !== "split" &&
    isShortCandidateSplitRun(samples, index) &&
    shouldKeepShortSplitRun(samples, index)
  ) {
    return restoreShortSplitCandidate(sample) ?? sample;
  }
  return sample;
}

function compactTrack(track: ClipperLayoutTrack): ClipperRuntimeLayoutSample[] {
  return track.samples.map((_, index) => {
    const sample = finalSample(track.samples, index);
    return {
      t: sample.t,
      mode: sample.mode,
      viewports: sample.viewports,
      panelSubjects: sample.panelSubjects,
      cut: sample.cut,
      solidBackgroundColor: sample.solidBackgroundColor,
    };
  });
}

/** Materializes policy decisions once and deduplicates equivalent platform tracks by aspect. */
export function compactSmartCropForRuntime(blob: ClipperSmartCropBlob): ClipperRuntimeSmartCropBlob {
  const layoutTracks: ClipperRuntimeSmartCropBlob["layoutTracks"] = {};
  for (const [formatId, aspectId] of FORMAT_ASPECTS) {
    if (layoutTracks[aspectId]) continue;
    const track = blob.layoutTracks?.[formatId] ?? blob.layoutTracks?.default;
    if (!track) continue;
    layoutTracks[aspectId] = {
      targetAspectRatio: track.targetAspectRatio,
      samples: compactTrack(track),
    };
  }
  return {
    renderSchemaVersion: 1,
    analyzerVersion: blob.analyzerVersion,
    modelId: blob.modelId,
    engine: blob.engine,
    trackerVersion: blob.trackerVersion,
    clipStart: blob.clipStart,
    clipEnd: blob.clipEnd,
    cameraSmoothing: blob.cameraSmoothing,
    contentRect: blob.contentRect,
    solidBackgroundColor: blob.solidBackgroundColor,
    layoutTracks,
  };
}
