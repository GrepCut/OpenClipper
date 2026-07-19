import type {
  ClipperLayoutSample,
  ClipperLayoutTrack,
  DetectorSegmentDecision,
} from "../../shared/smart-crop";
import { coveredFraction, interpolateBox, precedingIndex } from "./layout-arbiter";

const EPSILON = 1e-9;

export interface SpliceDetectorSegmentsInput {
  layoutTracks: Record<string, ClipperLayoutTrack>;
  detectorLayoutTracks: Record<string, ClipperLayoutTrack>;
  decisions: DetectorSegmentDecision[];
}

export interface SpliceDetectorSegmentsResult {
  layoutTracks: Record<string, ClipperLayoutTrack>;
  swappedSampleCount: number;
}

interface ResolvedDetectorFrame {
  mode: ClipperLayoutSample["mode"];
  viewports: ClipperLayoutSample["viewports"];
  coverageBoxes: ClipperLayoutSample["coverageBoxes"];
  qualityTelemetry: ClipperLayoutSample["qualityTelemetry"];
}

/**
 * Resolves the detector-candidate geometry governing `time`, mirroring the
 * benchmark replay's `composeFrames`: interpolation never crosses a cut,
 * mode, strategy, or viewport-count change, holds instead of interpolating
 * when an intermediate frame would uncover a required box, and yields
 * nothing for legacy-baseline samples (the replay fell back to the
 * production frame there, so the splice must treat them as no-swap).
 */
function resolveDetectorFrame(
  track: ClipperLayoutTrack,
  timeline: Array<{ time: number }>,
  time: number,
): ResolvedDetectorFrame | null {
  const index = precedingIndex(timeline, time);
  const previous = track.samples[index];
  if (!previous) return null;
  const next = track.samples[index + 1];
  let viewports = previous.viewports;
  let coverageBoxes = previous.coverageBoxes;
  if (
    next && !next.cut && next.mode === previous.mode && next.strategy === previous.strategy
    && next.viewports.length === previous.viewports.length
  ) {
    const factor = Math.max(0, Math.min(1, (time - previous.t) / Math.max(EPSILON, next.t - previous.t)));
    const interpolatedViewports = previous.viewports.map((viewport, viewportIndex) =>
      interpolateBox(viewport, next.viewports[viewportIndex]!, factor));
    const interpolatedCoverageBoxes = previous.coverageBoxes?.length === next.coverageBoxes?.length
      ? previous.coverageBoxes?.map((box, boxIndex) => interpolateBox(box, next.coverageBoxes![boxIndex]!, factor))
      : previous.coverageBoxes;
    const interpolationSafe = !interpolatedCoverageBoxes?.length || interpolatedCoverageBoxes.every((box) =>
      interpolatedViewports.some((viewport) => coveredFraction(viewport, box) >= 1 - EPSILON));
    if (interpolationSafe) {
      viewports = interpolatedViewports;
      coverageBoxes = interpolatedCoverageBoxes;
    }
  }
  if (!viewports.length || previous.strategy === "legacy-baseline") return null;
  return {
    mode: previous.mode,
    viewports,
    coverageBoxes,
    qualityTelemetry: previous.qualityTelemetry,
  };
}

/**
 * Iteration 11: routes eligible segments to the detector candidate. Pure —
 * returns new tracks and never mutates its inputs. Swap rules are frozen to
 * the run-4 shadow configuration: a production sample is replaced only when
 * the governing segment decision chose the detector AND the detector frame's
 * layout mode matches the production mode (contain included). Everything else
 * keeps the production sample untouched.
 */
export function spliceDetectorSegments(
  input: SpliceDetectorSegmentsInput,
): SpliceDetectorSegmentsResult {
  const { decisions } = input;
  if (!decisions.some((decision) => decision.useDetector)) {
    return { layoutTracks: input.layoutTracks, swappedSampleCount: 0 };
  }
  let swappedSampleCount = 0;
  const layoutTracks = Object.fromEntries(Object.entries(input.layoutTracks).map(([formatId, track]) => {
    const detectorTrack = input.detectorLayoutTracks[formatId];
    if (!detectorTrack?.samples.length) return [formatId, track];
    const detectorTimeline = detectorTrack.samples.map((sample) => ({ time: sample.t }));
    let decisionIndex = 0;
    const samples = track.samples.map((sample): ClipperLayoutSample => {
      while (
        decisionIndex + 1 < decisions.length
        && decisions[decisionIndex + 1]!.start <= sample.t + EPSILON
      ) {
        decisionIndex++;
      }
      const decision = decisions[decisionIndex];
      if (!decision?.useDetector) return sample;
      const detector = resolveDetectorFrame(detectorTrack, detectorTimeline, sample.t);
      if (!detector || detector.mode !== sample.mode) return sample;
      swappedSampleCount++;
      // Router codes are appended, never prepended: the replay engine reads
      // the recorded codes positionally ("visibility-controller" at index 0)
      // and by membership ("baseline-padding"), and both must survive.
      return {
        ...sample,
        strategy: "detector-splice",
        viewports: detector.viewports,
        coverageBoxes: detector.coverageBoxes,
        qualityTelemetry: detector.qualityTelemetry,
        routerSwapped: true,
        reasonCodes: [...(sample.reasonCodes ?? []), "segment-detector-router", ...decision.reasonCodes],
      };
    });
    return [formatId, { targetAspectRatio: track.targetAspectRatio, samples }];
  }));
  return { layoutTracks, swappedSampleCount };
}
