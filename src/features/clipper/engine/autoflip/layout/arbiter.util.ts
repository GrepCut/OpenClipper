import { clamp } from "../../../lib/math.util";
import type {
  ClipperLayoutMode,
  ClipperLayoutStrategy,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../../shared/smart-crop.util";
import { importanceGeometry } from "../salience/importance-ranker.util";
import type { ArbiterDecision, ArbiterParams, ArbiterSampleContext } from "../../types/autoflip-layout.types";

const EPSILON = 1e-9;

export const LEGACY_ARBITER_PARAMS: Readonly<ArbiterParams> = Object.freeze({
  decisionConfidenceScale: 0.3,
  minimumSemanticScoreGain: 0.05,
  emergencyBaselineCoverage: 0.85,
});

/**
 * Production policy (`analyze-subjects.ts` always builds with
 * `enhancedIdentityFusion: true`). The visibility controller is always enabled
 * in production and reports its decision via `controllerReasonCodes` — the
 * arbiter still rejects cosmetic, low-confidence moves unless legacy coverage
 * is unsafe for the selected required target.
 */
export const DEFAULT_ARBITER_PARAMS: Readonly<ArbiterParams> = Object.freeze({
  ...LEGACY_ARBITER_PARAMS,
  allowSplit: true,
});

export const RUN10_ARBITER_PARAMS = DEFAULT_ARBITER_PARAMS;
/** Compatibility name retained for the offline replay CLI. */
export const RUN9_ARBITER_PARAMS = DEFAULT_ARBITER_PARAMS;

export function requiredRegions(sample: ImportanceRegionSample): ImportanceRegion[] {
  return sample.regions.filter((region) => region.required).slice(0, 3);
}

export function coveredFraction(viewport: NormalizedBox, box: NormalizedBox): number {
  const area = Math.max(EPSILON, box.width * box.height);
  return clamp(importanceGeometry.intersectionArea(viewport, box) / area, 0, 1);
}

export function proposalScore(viewports: NormalizedBox[], required: ImportanceRegion[]): number {
  if (!required.length || !viewports.length) return 0;
  const totalWeight = required.reduce((sum, region) => sum + Math.max(0.01, region.importanceScore), 0);
  const coverage = required.reduce((sum, region) =>
    sum + Math.max(...viewports.map((viewport) => coveredFraction(viewport, region.contentBox))) * region.importanceScore, 0) / totalWeight;
  const primary = required.find((region) => region.role === "primary") ?? required[0]!;
  const primaryX = primary.box.x + primary.box.width / 2;
  const primaryY = primary.box.y + primary.box.height / 2;
  const distance = Math.min(...viewports.map((viewport) => {
    const dx = primaryX - (viewport.x + viewport.width / 2);
    const dy = primaryY - (viewport.y + viewport.height / 2);
    return Math.hypot(dx, dy);
  }));
  const composition = 1 - clamp(distance / 0.25, 0, 1);
  return coverage * 0.7 + composition * 0.3;
}

export function precedingIndex<T extends { time: number }>(items: T[], time: number): number {
  if (!items.length || time <= items[0]!.time) return 0;
  if (items.length === 1 || time >= items.at(-1)!.time) return items.length - 1;
  let low = 1;
  let high = items.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (items[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  return items[low]!.time <= time ? low : low - 1;
}

export function interpolateBox(a: NormalizedBox, b: NormalizedBox, factor: number): NormalizedBox {
  return {
    x: a.x + (b.x - a.x) * factor,
    y: a.y + (b.y - a.y) * factor,
    width: a.width + (b.width - a.width) * factor,
    height: a.height + (b.height - a.height) * factor,
  };
}

export function importanceAtTime(samples: ImportanceRegionSample[], time: number): ImportanceRegionSample {
  if (!samples.length) return { time, regions: [], targetEvidence: { status: "no-candidate", verifiedPersonCount: 0, unverifiedPersonCount: 0, temporallyQualifiedPersonCount: 0 } };
  const index = precedingIndex(samples, time);
  const previous = samples[index]!;
  const next = samples[index + 1];
  // Offline analysis may safely backfill a short detector dropout, but never
  // across a shot boundary. This fixes empty first samples without inventing
  // long look-ahead behavior.
  if (!previous.regions.length && next?.regions.length && !next.cut && next.time - time <= 0.4 + EPSILON) {
    return { ...next, time, cut: previous.cut };
  }
  if (!next || next.cut || next.time <= previous.time + EPSILON) return { ...previous, time };
  const factor = clamp((time - previous.time) / (next.time - previous.time), 0, 1);
  const regions = previous.regions.map((region) => {
    const nextRegion = next.regions.find((candidate) => candidate.id === region.id);
    return nextRegion ? {
      ...region,
      box: interpolateBox(region.box, nextRegion.box, factor),
      contentBox: interpolateBox(region.contentBox, nextRegion.contentBox, factor),
      importanceScore: region.importanceScore + (nextRegion.importanceScore - region.importanceScore) * factor,
    } : region;
  });
  return { time, regions, cut: previous.cut, targetEvidence: previous.targetEvidence };
}

/**
 * Chooses between the legacy AutoFlip baseline and the semantic proposal for
 * one layout sample. The visibility controller (always enabled in
 * production) has already picked mode and viewports and reports its
 * reasoning via `controllerReasonCodes` — the arbiter's only remaining job is
 * to honor that decision when the mode is allowed, and fall back to the
 * baseline otherwise (no controller decision, or a disallowed mode).
 */
export function decideLayoutStrategy(ctx: ArbiterSampleContext, params: ArbiterParams): ArbiterDecision {
  const modeAllowed = ctx.desiredMode === "single-crop"
    || (ctx.desiredMode === "split" && params.allowSplit === true);
  const controllerApproved = ctx.controllerReasonCodes != null;
  const scoreGain = ctx.semanticScore - ctx.baselineScore;
  const minimumGain = params.minimumSemanticScoreGain ?? 0.05;
  const emergencyCoverage = params.emergencyBaselineCoverage ?? 0.85;
  const baselineUnsafe = (ctx.baselineCoverage ?? 1) < emergencyCoverage;
  const scoreApproved = scoreGain >= minimumGain || baselineUnsafe;
  const selectSemantic = modeAllowed && controllerApproved && scoreApproved;

  const strategy: ClipperLayoutStrategy = selectSemantic
    ? ctx.desiredMode === "split"
      ? "semantic-split"
      : "semantic-single"
    : "legacy-baseline";

  const reasonCodes = selectSemantic
    ? [
        "visibility-controller",
        ...(ctx.controllerReasonCodes ?? []),
        ...(baselineUnsafe && scoreGain < minimumGain ? ["baseline-coverage-rescue"] : []),
      ]
    : [
        ...(!controllerApproved ? ["no-controller-decision"] : []),
        ...(controllerApproved ? ["visibility-controller", ...(ctx.controllerReasonCodes ?? [])] : []),
        ...(controllerApproved && !modeAllowed ? ["mode-not-allowed"] : []),
        ...(controllerApproved && modeAllowed && !scoreApproved
          ? [baselineUnsafe ? "baseline-coverage-unsafe" : "insufficient-semantic-margin"]
          : []),
      ];

  return {
    selectSemantic,
    strategy,
    reasonCodes,
    decisionConfidence: clamp(Math.max(0, ctx.semanticScore - ctx.baselineScore) / params.decisionConfidenceScale, 0, 1),
  };
}
