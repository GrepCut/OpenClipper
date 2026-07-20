import type { ClipperLayoutSample, NormalizedBox } from "../../../clipper/shared/smart-crop";
import {
  decideLayoutStrategy,
  importanceAtTime,
  interpolateBox,
  precedingIndex,
  proposalScore,
  requiredRegions,
  coveredFraction,
  type ArbiterParams,
} from "../../../clipper/engine/autoflip/layout-arbiter";
import {
  buildViewports,
  createVisibilityFramingState,
  DEFAULT_SEMANTIC_FRAMING_PARAMS,
  rawMode,
  type SemanticFramingParams,
} from "../../../clipper/engine/autoflip/layout-planner";
import {
  createVisibilityControllerState,
  planVisibilityRescue,
  ITERATION10_VISIBILITY_CONTROLLER_PARAMS,
  type VisibilityControllerParams,
  type VisibilityVariant,
} from "../../../clipper/engine/autoflip/visibility-controller";
import { REPLAY_METRIC_TOLERANCE } from "./replay-tolerance";
import { calculateBenchmarkMetrics, type BenchmarkFrameDetail, type BenchmarkFrameInput } from "../metrics";
import type { BenchmarkMetrics, TestKeyframe } from "../../types";
import type { ClipArtifacts, RecordedAutoflipDebug } from "./replay-io";
import { calculateReplayOracles, type ReplayOracleReport } from "./replay-oracles";

/** A recorded layout sample re-decided under candidate arbiter params. */
export interface ReplayedSample {
  t: number;
  cut: boolean;
  mode: ClipperLayoutSample["mode"];
  strategy: NonNullable<ClipperLayoutSample["strategy"]>;
  viewports: NormalizedBox[];
  reasonCodes?: string[];
  candidateVariants?: VisibilityVariant[];
  requiredRegionIds?: string[];
  subjectDisplayHeightFractions?: number[];
  coverageBoxes?: NormalizedBox[];
}

export interface ReplayGeometry {
  frameWidth: number;
  frameHeight: number;
  framing: SemanticFramingParams;
  visibilityController?: VisibilityControllerParams;
}

/**
 * Re-runs the arbiter over every recorded layout sample of one format track.
 * Reconstructs the exact ArbiterSampleContext the production planner saw;
 * everything needed is persisted in autoflip-debug.json.
 */
export function replayTrack(
  debug: RecordedAutoflipDebug,
  formatId: string,
  params: ArbiterParams,
  geometry?: ReplayGeometry,
): ReplayedSample[] {
  const track = debug.layoutTracks[formatId];
  if (!track) throw new Error(`No layout track for format ${formatId}.`);
  const importanceSamples = debug.importanceSamples;
  const visibilityState = createVisibilityFramingState();
  const visibilityControllerState = createVisibilityControllerState();
  return track.samples.map((sample) => {
    const importance = importanceAtTime(importanceSamples, sample.t);
    const importanceIndex = precedingIndex(importanceSamples, sample.t);
    const baselineViewports = sample.baselineViewports ?? sample.viewports;
    const desiredMode = geometry
      ? rawMode(importance, geometry.frameWidth / Math.max(1, geometry.frameHeight), track.targetAspectRatio)
      : sample.candidateMode ?? sample.mode;
    let semanticViewports = geometry
      ? buildViewports(
          desiredMode,
          importance,
          baselineViewports[0]!,
          geometry.frameWidth / Math.max(1, geometry.frameHeight),
          track.targetAspectRatio,
          geometry.framing,
          visibilityState,
          Boolean(sample.cut),
        )
      : sample.candidateViewports ?? [];
    const required = requiredRegions(importance);
    const visibilityDecision = geometry?.visibilityController?.enabled
      ? planVisibilityRescue({
          samples: importanceSamples,
          importanceIndex,
          baselineViewport: baselineViewports[0]!,
          sourceAspect: geometry.frameWidth / Math.max(1, geometry.frameHeight),
          targetAspect: track.targetAspectRatio,
          state: visibilityControllerState,
          params: geometry.visibilityController,
        })
      : null;
    const recordedControllerReasonCodes = !geometry && sample.reasonCodes?.[0] === "visibility-controller"
      ? sample.reasonCodes.slice(1)
      : undefined;
    const selectedMode = visibilityDecision?.mode ?? desiredMode;
    if (visibilityDecision) semanticViewports = visibilityDecision.viewports;
    const coverageRegions = visibilityDecision?.envelopes ?? required;
    const baselineScore = geometry ? proposalScore(baselineViewports, coverageRegions) : sample.baselineScore ?? 0;
    const semanticScore = geometry ? proposalScore(semanticViewports, coverageRegions) : sample.semanticScore ?? 0;
    const decision = decideLayoutStrategy({
      desiredMode: selectedMode,
      baselineScore,
      semanticScore,
      controllerReasonCodes: visibilityDecision?.reasonCodes ?? recordedControllerReasonCodes,
    }, params);
    // The Run4 crop is recorded as `viewports` whenever the baseline won, and
    // (from Run6 schemas on) always as `baselineViewports`. A Run5 sample that
    // originally went semantic has no exact baseline crop; its viewports only
    // gate interpolation shape, never scoring, because legacy frames are
    // composed from the recorded baseline jsonl rows.
    // Spliced samples keep the production pre-splice mode, so it is the
    // faithful baseline for re-deciding them just like legacy-baseline rows.
    const baselineMode = sample.strategy === "legacy-baseline" || sample.strategy === "detector-splice"
      ? sample.mode
      : "single-crop";
    return {
      t: sample.t,
      cut: Boolean(sample.cut),
      mode: decision.selectSemantic ? selectedMode : baselineMode,
      strategy: decision.strategy,
      viewports: decision.selectSemantic ? semanticViewports : baselineViewports,
      reasonCodes: decision.reasonCodes,
      candidateVariants: visibilityDecision?.variants,
      requiredRegionIds: required.map((region) => region.id),
      subjectDisplayHeightFractions: coverageRegions.map((region) => Math.min(1, Math.max(
        ...(decision.selectSemantic ? semanticViewports : baselineViewports).map((viewport) =>
          region.contentBox.height / Math.max(1e-9, viewport.height)),
      ))),
      coverageBoxes: sample.coverageBoxes,
    };
  });
}

/**
 * Mirrors production frame composition exactly: per decoded-frame timestamp,
 * the governing layout sample is interpolated (`interpolateLayoutSample`
 * semantics — never across a cut, strategy, mode, or viewport-count change);
 * legacy-baseline frames fall through to the recorded Run4 baseline rows,
 * which also covers the podcast-collage split path that cannot be rebuilt
 * from autoflip-debug.json (`resolveClipperLayoutRender` + `run-analysis.ts`).
 */
export function composeFrames(
  samples: ReplayedSample[],
  baselineRows: BenchmarkFrameDetail[],
): BenchmarkFrameInput[] {
  const timeline = samples.map((sample) => ({ time: sample.t }));
  return baselineRows.map((row) => {
    const time = row.timestampUs / 1_000_000;
    const index = precedingIndex(timeline, time);
    const previous = samples[index];
    if (!previous) return { timestampUs: row.timestampUs, viewports: row.viewports, layoutMode: row.layoutMode };
    const next = samples[index + 1];
    let viewports = previous.viewports;
    let reasonCodes = previous.reasonCodes;
    if (next && !next.cut && next.mode === previous.mode && next.strategy === previous.strategy
      && next.viewports.length === previous.viewports.length) {
      const factor = Math.max(0, Math.min(1, (time - previous.t) / Math.max(1e-9, next.t - previous.t)));
      const interpolatedViewports = previous.viewports.map((viewport, viewportIndex) =>
        interpolateBox(viewport, next.viewports[viewportIndex]!, factor));
      const interpolatedCoverageBoxes = previous.coverageBoxes?.length === next.coverageBoxes?.length
        ? previous.coverageBoxes?.map((box, boxIndex) => interpolateBox(box, next.coverageBoxes![boxIndex]!, factor))
        : previous.coverageBoxes;
      const interpolationSafe = !interpolatedCoverageBoxes?.length || interpolatedCoverageBoxes.every((box) =>
        interpolatedViewports.some((viewport) => coveredFraction(viewport, box) >= 1 - 1e-9));
      if (interpolationSafe) {
        viewports = interpolatedViewports;
      } else {
        reasonCodes = [...(previous.reasonCodes ?? []), "interpolation-hold-coverage"];
      }
    }
    if (!viewports.length || previous.strategy === "legacy-baseline") {
      return {
        timestampUs: row.timestampUs,
        viewports: row.viewports,
        layoutMode: row.layoutMode,
        reasonCodes,
        requiredRegionIds: previous.requiredRegionIds,
        subjectDisplayHeightFractions: previous.subjectDisplayHeightFractions,
        cut: previous.cut && Math.abs(row.timestampUs / 1_000_000 - previous.t) <= 0.05,
      };
    }
    return {
      timestampUs: row.timestampUs,
      viewports,
      layoutMode: previous.mode,
      reasonCodes,
      requiredRegionIds: previous.requiredRegionIds,
      subjectDisplayHeightFractions: previous.subjectDisplayHeightFractions,
      cut: previous.cut && Math.abs(row.timestampUs / 1_000_000 - previous.t) <= 0.05,
    };
  });
}

export interface ClipReplayResult {
  clipId: string;
  clipName: string;
  metrics: BenchmarkMetrics;
  strategyCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
  counterfactualCounts: Record<string, number>;
  counterfactualMetrics: Record<string, BenchmarkMetrics>;
  oracles: ReplayOracleReport;
}

export function scoreClip(
  frames: BenchmarkFrameInput[],
  keyframes: TestKeyframe[],
  dims: { width: number; height: number },
): BenchmarkMetrics {
  return calculateBenchmarkMetrics({
    keyframes,
    frames,
    sourceWidth: dims.width,
    sourceHeight: dims.height,
  }).metrics;
}

export function replayClip(
  clip: ClipArtifacts,
  params: ArbiterParams,
  framing?: SemanticFramingParams,
  visibilityController?: VisibilityControllerParams,
): ClipReplayResult {
  // RUN10_ARBITER_PARAMS is the only params object that sets both flags —
  // this mirrors production, which always pairs it with the Iteration 10
  // visibility controller.
  const controller = visibilityController ?? (params.allowSplit === true && params.allowContain === true
    ? { ...ITERATION10_VISIBILITY_CONTROLLER_PARAMS }
    : undefined);
  const samples = replayTrack(clip.debug, clip.formatId, params, framing || controller ? {
    frameWidth: clip.dims.width,
    frameHeight: clip.dims.height,
    framing: framing ?? DEFAULT_SEMANTIC_FRAMING_PARAMS,
    visibilityController: controller,
  } : undefined);
  const frames = composeFrames(samples, clip.baselineRows);
  const oracles = calculateReplayOracles({
    keyframes: clip.keyframes,
    importanceSamples: clip.debug.importanceSamples,
    replaySamples: samples,
    frames,
    subjectSamples: clip.debug.subjectSamples,
  });
  const strategyCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  const counterfactualCounts: Record<string, number> = {};
  for (const sample of samples) {
    strategyCounts[sample.strategy] = (strategyCounts[sample.strategy] ?? 0) + 1;
    for (const reason of sample.reasonCodes ?? []) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    for (const candidate of sample.candidateVariants ?? []) {
      counterfactualCounts[candidate.kind] = (counterfactualCounts[candidate.kind] ?? 0) + 1;
    }
  }
  const counterfactualMetrics: Record<string, BenchmarkMetrics> = {};
  const kinds: VisibilityVariant["kind"][] = [
    "run8-baseline",
    "shifted-crop",
    "wider-crop",
    "stable-split-v2",
    "stable-split-v3",
    "contain-fail-safe",
  ];
  for (const kind of kinds) {
    const variantSamples = samples.map((sample): ReplayedSample => {
      const candidate = sample.candidateVariants?.find((entry) => entry.kind === kind);
      if (!candidate || kind === "run8-baseline") {
        return { ...sample, strategy: "legacy-baseline" };
      }
      return {
        ...sample,
        mode: candidate.mode,
        strategy: candidate.mode === "split"
          ? "semantic-split"
          : candidate.mode === "contain"
            ? "semantic-contain"
            : "semantic-single",
        viewports: candidate.viewports,
      };
    });
    counterfactualMetrics[kind] = scoreClip(composeFrames(variantSamples, clip.baselineRows), clip.keyframes, clip.dims);
  }
  const metrics = scoreClip(frames, clip.keyframes, clip.dims);
  metrics.missLedger = oracles.missLedger;
  return {
    clipId: clip.clipId,
    clipName: clip.dims.name,
    metrics,
    strategyCounts,
    reasonCounts,
    counterfactualCounts,
    counterfactualMetrics,
    oracles,
  };
}

export interface AggregateMetrics {
  coverageHit: number;
  coverage: number;
  /** Mean over clips that have dual-target frames, like computeBenchmarkColumnStats. */
  dualAllCovered: number | null;
  clipCount: number;
  containDutyCycle?: number;
  modeSwitchesPerMinute?: number;
  p95ViewportCenterVelocity?: number | null;
  p95ViewportCenterAcceleration?: number | null;
}

/** Per-clip averages, matching `computeBenchmarkColumnStats.portrait9x16`. */
export function aggregate(results: ClipReplayResult[]): AggregateMetrics {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const dual = results
    .map((result) => result.metrics.dualTargetAllCoveredRate)
    .filter((value): value is number => value != null);
  return {
    coverageHit: mean(results.map((result) => result.metrics.coverageHitRate)),
    coverage: mean(results.map((result) => result.metrics.meanCoverageFraction)),
    dualAllCovered: dual.length ? mean(dual) : null,
    clipCount: results.length,
    containDutyCycle: mean(results.map((result) => result.metrics.containDutyCycle ?? 0)),
    modeSwitchesPerMinute: mean(results.map((result) => result.metrics.modeSwitchesPerMinute ?? 0)),
    p95ViewportCenterVelocity: mean(results
      .map((result) => result.metrics.p95ViewportCenterVelocity)
      .filter((value): value is number => value != null)),
    p95ViewportCenterAcceleration: mean(results
      .map((result) => result.metrics.p95ViewportCenterAcceleration)
      .filter((value): value is number => value != null)),
  };
}

export interface SelfCheckResult {
  passed: boolean;
  failures: string[];
}

export { REPLAY_METRIC_TOLERANCE as SELF_CHECK_METRIC_TOLERANCE } from "./replay-tolerance";

/**
 * With default params the replay must reproduce the recorded run exactly:
 * identical per-sample strategies and per-clip selected metrics (tiny float
 * tolerance for the JSON round trip), and the recorded 18-clip aggregate.
 */
export function selfCheck(
  clips: ClipArtifacts[],
  params: ArbiterParams,
  recordedAggregate: { coverageHit: number | null; coverage: number | null; dualAllCovered: number | null },
): SelfCheckResult {
  const failures: string[] = [];
  const results: ClipReplayResult[] = [];
  for (const clip of clips) {
    const samples = replayTrack(clip.debug, clip.formatId, params);
    const recorded = clip.debug.layoutTracks[clip.formatId]!.samples;
    for (const [index, sample] of samples.entries()) {
      const expected = recorded[index]!.strategy ?? "legacy-baseline";
      if (sample.strategy !== expected) {
        failures.push(`${clip.dims.name}: sample ${index} (t=${sample.t.toFixed(3)}) replayed ${sample.strategy}, recorded ${expected}`);
        break;
      }
    }
    // A self-check validates the persisted candidate geometry itself. A
    // parameter sweep intentionally rebuilds controller geometry, but doing
    // that here can introduce threshold-level float drift even when every
    // recorded strategy is reproduced.
    const result = replayClip(clip, params);
    result.metrics = scoreClip(composeFrames(samples, clip.baselineRows), clip.keyframes, clip.dims);
    results.push(result);
    const recordedMetrics = clip.comparison.selected;
    const checks: Array<[string, number, number | null]> = [
      ["coverageHitRate", result.metrics.coverageHitRate, recordedMetrics.coverageHitRate],
      ["meanCoverageFraction", result.metrics.meanCoverageFraction, recordedMetrics.meanCoverageFraction],
      ["dualTargetAllCoveredRate", result.metrics.dualTargetAllCoveredRate ?? -1, recordedMetrics.dualTargetAllCoveredRate ?? -1],
    ];
    for (const [label, actual, expected] of checks) {
      if (expected == null) continue;
      if (Math.abs(actual - expected) > REPLAY_METRIC_TOLERANCE) {
        failures.push(`${clip.dims.name}: ${label} replayed ${actual.toFixed(6)}, recorded ${expected.toFixed(6)}`);
      }
    }
  }
  const overall = aggregate(results);
  const aggregateChecks: Array<[string, number | null, number | null]> = [
    ["aggregate coverageHit", overall.coverageHit, recordedAggregate.coverageHit],
    ["aggregate coverage", overall.coverage, recordedAggregate.coverage],
    ["aggregate dualAllCovered", overall.dualAllCovered, recordedAggregate.dualAllCovered],
  ];
  for (const [label, actual, expected] of aggregateChecks) {
    if (expected == null || actual == null) continue;
    if (Math.abs(actual - expected) > 0.0005) {
      failures.push(`${label}: replayed ${actual.toFixed(6)}, recorded ${expected.toFixed(6)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}
