import type { ClipperLayoutSample, NormalizedBox } from "../../../clipper/shared/smart-crop";
import {
  decideLayoutStrategy,
  importanceAtTime,
  interpolateBox,
  precedingIndex,
  requiredRegions,
  type ArbiterParams,
} from "../../../clipper/engine/autoflip/layout-arbiter";
import { calculateBenchmarkMetrics, type BenchmarkFrameDetail, type BenchmarkFrameInput } from "../metrics";
import type { BenchmarkMetrics, TestKeyframe } from "../../types";
import type { ClipArtifacts, RecordedAutoflipDebug } from "./replay-io";

/** A recorded layout sample re-decided under candidate arbiter params. */
export interface ReplayedSample {
  t: number;
  cut: boolean;
  mode: ClipperLayoutSample["mode"];
  strategy: NonNullable<ClipperLayoutSample["strategy"]>;
  viewports: NormalizedBox[];
}

function motionTypeForSample(debug: RecordedAutoflipDebug, formatId: string, time: number): string | undefined {
  return debug.scenes.find((scene) =>
    scene.formatId === formatId && time >= scene.start - 1e-9 && time < scene.end + 1e-9)?.motionType;
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
): ReplayedSample[] {
  const track = debug.layoutTracks[formatId];
  if (!track) throw new Error(`No layout track for format ${formatId}.`);
  const importanceSamples = debug.importanceSamples;
  return track.samples.map((sample) => {
    const desiredMode = sample.candidateMode ?? sample.mode;
    const explicitPadding = sample.reasonCodes?.includes("baseline-padding") ?? false;
    const importance = importanceAtTime(importanceSamples, sample.t);
    const importanceIndex = precedingIndex(importanceSamples, sample.t);
    const semanticViewports = sample.candidateViewports ?? [];
    const decision = decideLayoutStrategy({
      t: sample.t,
      cut: Boolean(sample.cut),
      explicitPadding,
      desiredMode,
      required: requiredRegions(importance),
      baselineScore: sample.baselineScore ?? 0,
      semanticScore: sample.semanticScore ?? 0,
      semanticViewports,
      importanceSamples,
      importanceIndex,
      motionType: motionTypeForSample(debug, formatId, sample.t),
    }, params);
    // The Run4 crop is recorded as `viewports` whenever the baseline won, and
    // (from Run6 schemas on) always as `baselineViewports`. A Run5 sample that
    // originally went semantic has no exact baseline crop; its viewports only
    // gate interpolation shape, never scoring, because legacy frames are
    // composed from the recorded baseline jsonl rows.
    const baselineViewports = sample.baselineViewports ?? sample.viewports;
    const baselineMode = sample.strategy === "legacy-baseline" ? sample.mode : "single-crop";
    return {
      t: sample.t,
      cut: Boolean(sample.cut),
      mode: decision.selectSemantic ? desiredMode : baselineMode,
      strategy: decision.strategy,
      viewports: decision.selectSemantic ? semanticViewports : baselineViewports,
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
    if (next && !next.cut && next.mode === previous.mode && next.strategy === previous.strategy
      && next.viewports.length === previous.viewports.length) {
      const factor = Math.max(0, Math.min(1, (time - previous.t) / Math.max(1e-9, next.t - previous.t)));
      viewports = previous.viewports.map((viewport, viewportIndex) =>
        interpolateBox(viewport, next.viewports[viewportIndex]!, factor));
    }
    if (!viewports.length || previous.strategy === "legacy-baseline") {
      return { timestampUs: row.timestampUs, viewports: row.viewports, layoutMode: row.layoutMode };
    }
    return { timestampUs: row.timestampUs, viewports, layoutMode: previous.mode };
  });
}

export interface ClipReplayResult {
  clipId: string;
  clipName: string;
  metrics: BenchmarkMetrics;
  strategyCounts: Record<string, number>;
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

export function replayClip(clip: ClipArtifacts, params: ArbiterParams): ClipReplayResult {
  const samples = replayTrack(clip.debug, clip.formatId, params);
  const frames = composeFrames(samples, clip.baselineRows);
  const strategyCounts: Record<string, number> = {};
  for (const sample of samples) strategyCounts[sample.strategy] = (strategyCounts[sample.strategy] ?? 0) + 1;
  return {
    clipId: clip.clipId,
    clipName: clip.dims.name,
    metrics: scoreClip(frames, clip.keyframes, clip.dims),
    strategyCounts,
  };
}

export interface AggregateMetrics {
  focusHit: number;
  visibility: number;
  /** Mean over clips that have dual-target frames, like computeBenchmarkColumnStats. */
  dualAllVisible: number | null;
  clipCount: number;
}

/** Per-clip averages, matching `computeBenchmarkColumnStats.portrait9x16`. */
export function aggregate(results: ClipReplayResult[]): AggregateMetrics {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const dual = results
    .map((result) => result.metrics.dualTargetAllVisibleRate)
    .filter((value): value is number => value != null);
  return {
    focusHit: mean(results.map((result) => result.metrics.focusHitRate)),
    visibility: mean(results.map((result) => result.metrics.targetVisibilityRate)),
    dualAllVisible: dual.length ? mean(dual) : null,
    clipCount: results.length,
  };
}

export interface SelfCheckResult {
  passed: boolean;
  failures: string[];
}

/**
 * With default params the replay must reproduce the recorded run exactly:
 * identical per-sample strategies and per-clip selected metrics (tiny float
 * tolerance for the JSON round trip), and the recorded 18-clip aggregate.
 */
export function selfCheck(
  clips: ClipArtifacts[],
  params: ArbiterParams,
  recordedAggregate: { focusHit: number | null; visibility: number | null; dualAllVisible: number | null },
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
    const result = replayClip(clip, params);
    results.push(result);
    const recordedMetrics = clip.comparison.selected;
    const checks: Array<[string, number, number | null]> = [
      ["focusHitRate", result.metrics.focusHitRate, recordedMetrics.focusHitRate],
      ["targetVisibilityRate", result.metrics.targetVisibilityRate, recordedMetrics.targetVisibilityRate],
      ["dualTargetAllVisibleRate", result.metrics.dualTargetAllVisibleRate ?? -1, recordedMetrics.dualTargetAllVisibleRate ?? -1],
    ];
    for (const [label, actual, expected] of checks) {
      if (expected == null) continue;
      if (Math.abs(actual - expected) > 0.001) {
        failures.push(`${clip.dims.name}: ${label} replayed ${actual.toFixed(6)}, recorded ${expected.toFixed(6)}`);
      }
    }
  }
  const overall = aggregate(results);
  const aggregateChecks: Array<[string, number | null, number | null]> = [
    ["aggregate focusHit", overall.focusHit, recordedAggregate.focusHit],
    ["aggregate visibility", overall.visibility, recordedAggregate.visibility],
    ["aggregate dualAllVisible", overall.dualAllVisible, recordedAggregate.dualAllVisible],
  ];
  for (const [label, actual, expected] of aggregateChecks) {
    if (expected == null || actual == null) continue;
    if (Math.abs(actual - expected) > 0.0005) {
      failures.push(`${label}: replayed ${actual.toFixed(6)}, recorded ${expected.toFixed(6)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}
