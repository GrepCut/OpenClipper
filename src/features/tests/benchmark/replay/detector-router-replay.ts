import type { BenchmarkFrameInput } from "../metrics";
import type { BenchmarkMetrics } from "../../types";
import {
  buildGroupUnionLayout,
  routeDetectorSegments,
  type DetectorSegmentDecision,
  type DetectorSegmentRouterParams,
} from "../../../clipper/engine/autoflip/segment-detector-router";
import {
  detectorHypothesisSamplesForDebug,
  type ClipArtifacts,
} from "./replay-io";
import { scoreClip } from "./replay-engine";
import { composeFrames, replayTrack } from "./replay-engine";
import { RUN10_ARBITER_PARAMS } from "../../../clipper/engine/autoflip/layout-arbiter";
import { DEFAULT_SEMANTIC_FRAMING_PARAMS } from "../../../clipper/engine/autoflip/layout-planner";
import { ITERATION10_VISIBILITY_CONTROLLER_PARAMS } from "../../../clipper/engine/autoflip/visibility-controller";

export interface DetectorRouterReplayResult {
  metrics: BenchmarkMetrics;
  decisions: DetectorSegmentDecision[];
  detectorFrameRate: number;
}

const semanticCandidateCache = new WeakMap<
  ClipArtifacts,
  Array<BenchmarkFrameInput | undefined>
>();
const groupUnionCandidateCache = new WeakMap<
  ClipArtifacts,
  Array<BenchmarkFrameInput | undefined>
>();
const iteration10CandidateCache = new WeakMap<
  ClipArtifacts,
  Array<BenchmarkFrameInput | undefined>
>();

const STABLE_DETECTOR_VISIBILITY_PARAMS = {
  ...ITERATION10_VISIBILITY_CONTROLLER_PARAMS,
  splitPendingSec: 0.8,
  splitMinDurationSec: 2,
  splitExitStableSec: 1.6,
  containMinDurationSec: 0.8,
  widerHoldSec: 1.6,
  maxSwitchesPerMinute: 4,
};

function frameInput(
  row: ClipArtifacts["baselineRows"][number],
): BenchmarkFrameInput {
  return {
    timestampUs: row.timestampUs,
    viewports: row.viewports,
    layoutMode: row.layoutMode,
    reasonCodes: row.reasonCodes,
  };
}

function semanticCandidateFrames(
  clip: ClipArtifacts,
): Array<BenchmarkFrameInput | undefined> {
  const cached = semanticCandidateCache.get(clip);
  if (cached) return cached;
  const detectorTrack =
    clip.debug.candidates?.yolox?.layoutTracks[clip.formatId];
  let sampleIndex = 0;
  const frames = clip.selectedRows.map((baseline) => {
    const time = baseline.timestampUs / 1_000_000;
    while (
      detectorTrack &&
      sampleIndex + 1 < detectorTrack.samples.length &&
      detectorTrack.samples[sampleIndex + 1]!.t <= time + 1e-9
    ) {
      sampleIndex++;
    }
    const sample = detectorTrack?.samples[sampleIndex];
    if (!sample?.candidateViewports?.length) return undefined;
    return {
      timestampUs: baseline.timestampUs,
      viewports: sample.candidateViewports,
      layoutMode: sample.candidateMode ?? sample.mode,
      reasonCodes: sample.reasonCodes,
    };
  });
  semanticCandidateCache.set(clip, frames);
  return frames;
}

function groupUnionCandidateFrames(
  clip: ClipArtifacts,
): Array<BenchmarkFrameInput | undefined> {
  const cached = groupUnionCandidateCache.get(clip);
  if (cached) return cached;
  const detectorTrack =
    clip.debug.candidates?.yolox?.layoutTracks[clip.formatId];
  let sampleIndex = 0;
  const frames = clip.selectedRows.map((baseline) => {
    const time = baseline.timestampUs / 1_000_000;
    while (
      detectorTrack &&
      sampleIndex + 1 < detectorTrack.samples.length &&
      detectorTrack.samples[sampleIndex + 1]!.t <= time + 1e-9
    ) {
      sampleIndex++;
    }
    const sample = detectorTrack?.samples[sampleIndex];
    const layout = buildGroupUnionLayout(
      sample?.coverageBoxes ?? [],
      clip.dims.width / Math.max(1, clip.dims.height),
      detectorTrack?.targetAspectRatio ?? 1,
    );
    if (!layout) return undefined;
    return {
      timestampUs: baseline.timestampUs,
      viewports: layout.viewports,
      layoutMode: layout.mode,
      reasonCodes: [layout.reasonCode],
    };
  });
  groupUnionCandidateCache.set(clip, frames);
  return frames;
}

function iteration10CandidateFrames(
  clip: ClipArtifacts,
): Array<BenchmarkFrameInput | undefined> {
  const cached = iteration10CandidateCache.get(clip);
  if (cached) return cached;
  const detector = clip.debug.candidates?.yolox;
  if (!detector) return [];
  const samples = replayTrack(
    {
      ...clip.debug,
      importanceSamples: detector.importanceSamples,
      layoutTracks: detector.layoutTracks,
    },
    clip.formatId,
    RUN10_ARBITER_PARAMS,
    {
      frameWidth: clip.dims.width,
      frameHeight: clip.dims.height,
      framing: DEFAULT_SEMANTIC_FRAMING_PARAMS,
      visibilityController: STABLE_DETECTOR_VISIBILITY_PARAMS,
    },
  );
  const frames = composeFrames(samples, clip.selectedRows);
  iteration10CandidateCache.set(clip, frames);
  return frames;
}

export function replayDetectorRouter(
  clip: ClipArtifacts,
  params: DetectorSegmentRouterParams,
  options: {
    allowDetectorContain?: boolean;
    requireModeMatch?: boolean;
    candidateGeometry?: "selected" | "semantic" | "group-union" | "iteration10";
  } = {},
): DetectorRouterReplayResult {
  const decisions = routeDetectorSegments(
    detectorHypothesisSamplesForDebug(clip.debug),
    params,
  );
  let decisionIndex = 0;
  let detectorFrames = 0;
  const semanticFrames =
    options.candidateGeometry === "semantic"
      ? semanticCandidateFrames(clip)
      : undefined;
  const groupUnionFrames =
    options.candidateGeometry === "group-union"
      ? groupUnionCandidateFrames(clip)
      : undefined;
  const iteration10Frames =
    options.candidateGeometry === "iteration10"
      ? iteration10CandidateFrames(clip)
      : undefined;
  const frames = clip.selectedRows.map(
    (baseline, index): BenchmarkFrameInput => {
      const time = baseline.timestampUs / 1_000_000;
      while (
        decisionIndex + 1 < decisions.length &&
        decisions[decisionIndex + 1]!.start <= time + 1e-9
      )
        decisionIndex++;
      const decision = decisions[decisionIndex];
      const recordedDetector = clip.detectorCandidateRows?.[index];
      const detector =
        options.candidateGeometry === "group-union"
          ? groupUnionFrames?.[index]
          : options.candidateGeometry === "iteration10"
            ? iteration10Frames?.[index]
            : (semanticFrames?.[index] ?? recordedDetector);
      if (
        decision?.useDetector &&
        detector &&
        (!options.requireModeMatch ||
          detector.layoutMode === baseline.layoutMode) &&
        (options.allowDetectorContain || detector.layoutMode !== "contain")
      ) {
        detectorFrames++;
        return {
          ...frameInput(detector),
          reasonCodes: ["segment-detector-router", ...decision.reasonCodes],
        };
      }
      return {
        ...frameInput(baseline),
        reasonCodes: decision
          ? ["segment-detector-router", ...decision.reasonCodes]
          : baseline.reasonCodes,
      };
    },
  );
  return {
    metrics: scoreClip(frames, clip.keyframes, clip.dims),
    decisions,
    detectorFrameRate: detectorFrames / Math.max(1, frames.length),
  };
}
