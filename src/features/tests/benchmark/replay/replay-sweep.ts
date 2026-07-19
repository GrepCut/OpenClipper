import { DEFAULT_ARBITER_PARAMS, type ArbiterParams } from "../../../clipper/engine/autoflip/layout-arbiter";
import type { SemanticFramingParams } from "../../../clipper/engine/autoflip/layout-planner";
import { aggregate, replayClip, type AggregateMetrics, type ClipReplayResult } from "./replay-engine";
import type { ClipArtifacts } from "./replay-io";

export interface ParamGrid {
  [key: string]: unknown[];
}

/** Cartesian product of a {param: values[]} grid into full param sets. */
export function expandGrid(grid: ParamGrid): ArbiterParams[] {
  const keys = Object.keys(grid);
  let combos: Array<Partial<ArbiterParams>> = [{}];
  for (const key of keys) {
    const values = grid[key]!;
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })));
  }
  return combos.map((combo) => ({ ...DEFAULT_ARBITER_PARAMS, ...combo }));
}

export interface EvaluatedParams {
  params: ArbiterParams;
  framing?: SemanticFramingParams;
  overall: AggregateMetrics;
  perClip: ClipReplayResult[];
  /** Deltas vs the recorded selected metrics of the source run, in rate units. */
  worstFocusDelta: number;
  worstVisibilityDelta: number;
  worstClipVisibility: number;
  qualityPenalty: number;
  /** Clips where visibility dropped by more than 10 pp. Focus is diagnostic only. */
  catastrophicClips: string[];
  /** Clips where focus or visibility dropped by more than 5 pp (soft flag). */
  regressedClips: string[];
  gates: { passed: boolean; reasons: string[] };
}

export interface GateThresholds {
  minFocus: number;
  minVisibility: number;
  minDual: number;
}

/** Run6 recorded 9:16 aggregate — the immutable promotion floor. */
export const RUN6_PORTRAIT_FLOOR: GateThresholds = {
  minFocus: 0.6925,
  minVisibility: 0.9091,
  minDual: 0.350063482044689,
};
/** Run 8 production floor used for Run 9 promotion. Focus is diagnostic only. */
export const RUN8_PORTRAIT_FLOOR: GateThresholds = {
  minFocus: 0,
  minVisibility: 0.9186,
  minDual: 0.5121,
};
/** Backwards-compatible export for existing replay scripts. */
export const RUN5_PORTRAIT_FLOOR = RUN6_PORTRAIT_FLOOR;

export function evaluateParams(
  clips: ClipArtifacts[],
  params: ArbiterParams,
  gatesAt: GateThresholds = RUN6_PORTRAIT_FLOOR,
  framing?: SemanticFramingParams,
): EvaluatedParams {
  const perClip = clips.map((clip) => replayClip(clip, params, framing));
  const overall = aggregate(perClip);
  let worstFocusDelta = 0;
  let worstVisibilityDelta = 0;
  let worstClipVisibility = 1;
  const catastrophicClips: string[] = [];
  const regressedClips: string[] = [];
  for (const [index, result] of perClip.entries()) {
    const recorded = clips[index]!.comparison.selected;
    const focusDelta = result.metrics.focusHitRate - recorded.focusHitRate;
    const visibilityDelta = result.metrics.targetVisibilityRate - recorded.targetVisibilityRate;
    worstFocusDelta = Math.min(worstFocusDelta, focusDelta);
    worstVisibilityDelta = Math.min(worstVisibilityDelta, visibilityDelta);
    worstClipVisibility = Math.min(worstClipVisibility, result.metrics.targetVisibilityRate);
    if (visibilityDelta < -0.1) catastrophicClips.push(result.clipName);
    else if (visibilityDelta < -0.05) regressedClips.push(result.clipName);
  }
  const containPenalty = Math.max(0, (overall.containDutyCycle ?? 0) - 0.05);
  const switchPenalty = Math.max(0, (overall.modeSwitchesPerMinute ?? 0) - 6) / 60;
  const qualityPenalty = containPenalty + switchPenalty;
  const reasons: string[] = [];
  if (overall.visibility < gatesAt.minVisibility) reasons.push(`visibility ${(overall.visibility * 100).toFixed(2)} < ${(gatesAt.minVisibility * 100).toFixed(2)}`);
  if ((overall.dualAllVisible ?? 0) < gatesAt.minDual) reasons.push(`dual ${((overall.dualAllVisible ?? 0) * 100).toFixed(2)} < ${(gatesAt.minDual * 100).toFixed(2)}`);
  if (catastrophicClips.length) reasons.push(`catastrophic: ${catastrophicClips.join(", ")}`);
  if ((overall.containDutyCycle ?? 0) > 0.05) reasons.push(`contain duty ${((overall.containDutyCycle ?? 0) * 100).toFixed(2)} > 5.00`);
  if ((overall.modeSwitchesPerMinute ?? 0) > 6) reasons.push(`mode switches ${(overall.modeSwitchesPerMinute ?? 0).toFixed(2)}/min > 6`);
  return {
    params,
    framing,
    overall,
    perClip,
    worstFocusDelta,
    worstVisibilityDelta,
    worstClipVisibility,
    qualityPenalty,
    catastrophicClips,
    regressedClips,
    gates: { passed: reasons.length === 0, reasons },
  };
}

/** Run 9 lexicographic objective. Focus is intentionally absent. */
export function compareByObjective(a: EvaluatedParams, b: EvaluatedParams): number {
  if (a.catastrophicClips.length !== b.catastrophicClips.length) {
    return a.catastrophicClips.length - b.catastrophicClips.length;
  }
  if (a.worstClipVisibility !== b.worstClipVisibility) return b.worstClipVisibility - a.worstClipVisibility;
  if (a.overall.visibility !== b.overall.visibility) return b.overall.visibility - a.overall.visibility;
  const dualA = a.overall.dualAllVisible ?? 0;
  const dualB = b.overall.dualAllVisible ?? 0;
  if (dualA !== dualB) return dualB - dualA;
  if (a.qualityPenalty !== b.qualityPenalty) return a.qualityPenalty - b.qualityPenalty;
  const costA = a.perClip.reduce((sum, result) => sum + (result.metrics.processingMs ?? 0), 0);
  const costB = b.perClip.reduce((sum, result) => sum + (result.metrics.processingMs ?? 0), 0);
  return costA - costB;
}

export function sweep(
  clips: ClipArtifacts[],
  paramSets: ArbiterParams[],
  gatesAt: GateThresholds = RUN6_PORTRAIT_FLOOR,
  onProgress?: (done: number, total: number) => void,
): EvaluatedParams[] {
  const evaluated = paramSets.map((params, index) => {
    const result = evaluateParams(clips, params, gatesAt);
    onProgress?.(index + 1, paramSets.length);
    return result;
  });
  return evaluated.sort(compareByObjective);
}

export interface LocoFold {
  heldOutClip: string;
  chosenParams: ArbiterParams;
  trainFocus: number;
  heldOut: { focusHit: number; visibility: number; dualAllVisible: number | null };
  recordedHeldOut: { focusHit: number; visibility: number; dualAllVisible: number | null };
}

export interface LocoReport {
  folds: LocoFold[];
  /** Mean held-out metrics across folds — the honest generalization estimate. */
  heldOutMean: { focusHit: number; visibility: number; dualAllVisible: number | null };
  recordedMean: { focusHit: number; visibility: number; dualAllVisible: number | null };
  /** How often each distinct winning param set was chosen across folds. */
  paramStability: Array<{ params: ArbiterParams; folds: number }>;
}

/**
 * Leave-one-clip-out: pick the objective-best param set on 17 clips, score the
 * held-out clip with it. Whole clips only — frames of one clip never straddle
 * the train/holdout boundary, and clip identity is never visible to params.
 */
export function leaveOneClipOut(
  clips: ClipArtifacts[],
  paramSets: ArbiterParams[],
  gatesAt: GateThresholds = RUN6_PORTRAIT_FLOOR,
  onProgress?: (done: number, total: number) => void,
): LocoReport {
  const folds: LocoFold[] = [];
  for (const [index, heldOut] of clips.entries()) {
    const train = clips.filter((_, clipIndex) => clipIndex !== index);
    const best = sweep(train, paramSets, gatesAt)[0]!;
    const heldOutResult = replayClip(heldOut, best.params);
    folds.push({
      heldOutClip: heldOut.dims.name,
      chosenParams: best.params,
      trainFocus: best.overall.focusHit,
      heldOut: {
        focusHit: heldOutResult.metrics.focusHitRate,
        visibility: heldOutResult.metrics.targetVisibilityRate,
        dualAllVisible: heldOutResult.metrics.dualTargetAllVisibleRate,
      },
      recordedHeldOut: {
        focusHit: heldOut.comparison.selected.focusHitRate,
        visibility: heldOut.comparison.selected.targetVisibilityRate,
        dualAllVisible: heldOut.comparison.selected.dualTargetAllVisibleRate,
      },
    });
    onProgress?.(index + 1, clips.length);
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const dual = folds.map((fold) => fold.heldOut.dualAllVisible).filter((value): value is number => value != null);
  const recordedDual = folds.map((fold) => fold.recordedHeldOut.dualAllVisible).filter((value): value is number => value != null);
  const byKey = new Map<string, { params: ArbiterParams; folds: number }>();
  for (const fold of folds) {
    const key = JSON.stringify(fold.chosenParams);
    const entry = byKey.get(key) ?? { params: fold.chosenParams, folds: 0 };
    entry.folds += 1;
    byKey.set(key, entry);
  }
  return {
    folds,
    heldOutMean: {
      focusHit: mean(folds.map((fold) => fold.heldOut.focusHit)),
      visibility: mean(folds.map((fold) => fold.heldOut.visibility)),
      dualAllVisible: dual.length ? mean(dual) : null,
    },
    recordedMean: {
      focusHit: mean(folds.map((fold) => fold.recordedHeldOut.focusHit)),
      visibility: mean(folds.map((fold) => fold.recordedHeldOut.visibility)),
      dualAllVisible: recordedDual.length ? mean(recordedDual) : null,
    },
    paramStability: [...byKey.values()].sort((a, b) => b.folds - a.folds),
  };
}

export function expandFramingGrid(grid: ParamGrid): SemanticFramingParams[] {
  const keys = Object.keys(grid);
  let combinations: Array<Partial<SemanticFramingParams>> = [{}];
  for (const key of keys) {
    combinations = combinations.flatMap((combination) =>
      grid[key]!.map((value) => ({ ...combination, [key]: value })));
  }
  return combinations.map((combination) => {
    const candidate = combination as SemanticFramingParams;
    if ((candidate.targetBoxSource !== "box" && candidate.targetBoxSource !== "contentBox")
      || !Number.isFinite(candidate.centerYFraction)
      || !Number.isFinite(candidate.padding)
      || !Number.isFinite(candidate.minimumScale)
      || (candidate.visibilityGuardMargin != null && !Number.isFinite(candidate.visibilityGuardMargin))
      || (candidate.stablePrimaryKeyframes != null && !Number.isFinite(candidate.stablePrimaryKeyframes))
      || (candidate.scaleHysteresis != null && !Number.isFinite(candidate.scaleHysteresis))
      || (candidate.maxCenterStep != null && !Number.isFinite(candidate.maxCenterStep))
      || (candidate.maxScaleStep != null && !Number.isFinite(candidate.maxScaleStep))
      || (candidate.allowedScales != null && (!Array.isArray(candidate.allowedScales)
        || candidate.allowedScales.some((scale) => !Number.isFinite(scale))))) {
      throw new Error(`Invalid semantic framing grid entry: ${JSON.stringify(candidate)}`);
    }
    return candidate;
  });
}

export function sweepFraming(
  clips: ClipArtifacts[],
  framingSets: SemanticFramingParams[],
  params: ArbiterParams = DEFAULT_ARBITER_PARAMS,
  gatesAt: GateThresholds = RUN6_PORTRAIT_FLOOR,
  onProgress?: (done: number, total: number) => void,
): EvaluatedParams[] {
  return framingSets.map((framing, index) => {
    const result = evaluateParams(clips, params, gatesAt, framing);
    onProgress?.(index + 1, framingSets.length);
    return result;
  }).sort(compareByObjective);
}

export interface FramingLocoReport {
  folds: Array<{
    heldOutClip: string;
    chosenFraming: SemanticFramingParams;
    heldOut: { focusHit: number; visibility: number; dualAllVisible: number | null };
    recordedHeldOut: { focusHit: number; visibility: number; dualAllVisible: number | null };
  }>;
  heldOutMean: AggregateMetrics;
  recordedMean: AggregateMetrics;
  framingStability: Array<{ framing: SemanticFramingParams; folds: number }>;
}

export function leaveOneClipOutFraming(
  clips: ClipArtifacts[],
  framingSets: SemanticFramingParams[],
  params: ArbiterParams = DEFAULT_ARBITER_PARAMS,
  gatesAt: GateThresholds = RUN6_PORTRAIT_FLOOR,
  onProgress?: (done: number, total: number) => void,
): FramingLocoReport {
  const folds: FramingLocoReport["folds"] = [];
  for (const [index, heldOut] of clips.entries()) {
    const train = clips.filter((_, clipIndex) => clipIndex !== index);
    const best = sweepFraming(train, framingSets, params, gatesAt)[0]!;
    const result = replayClip(heldOut, params, best.framing);
    folds.push({
      heldOutClip: heldOut.dims.name,
      chosenFraming: best.framing!,
      heldOut: {
        focusHit: result.metrics.focusHitRate,
        visibility: result.metrics.targetVisibilityRate,
        dualAllVisible: result.metrics.dualTargetAllVisibleRate,
      },
      recordedHeldOut: {
        focusHit: heldOut.comparison.selected.focusHitRate,
        visibility: heldOut.comparison.selected.targetVisibilityRate,
        dualAllVisible: heldOut.comparison.selected.dualTargetAllVisibleRate,
      },
    });
    onProgress?.(index + 1, clips.length);
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const aggregateFolds = (source: "heldOut" | "recordedHeldOut"): AggregateMetrics => {
    const dual = folds.map((fold) => fold[source].dualAllVisible).filter((value): value is number => value != null);
    return {
      focusHit: mean(folds.map((fold) => fold[source].focusHit)),
      visibility: mean(folds.map((fold) => fold[source].visibility)),
      dualAllVisible: dual.length ? mean(dual) : null,
      clipCount: folds.length,
    };
  };
  const stability = new Map<string, { framing: SemanticFramingParams; folds: number }>();
  for (const fold of folds) {
    const key = JSON.stringify(fold.chosenFraming);
    const entry = stability.get(key) ?? { framing: fold.chosenFraming, folds: 0 };
    entry.folds++;
    stability.set(key, entry);
  }
  return {
    folds,
    heldOutMean: aggregateFolds("heldOut"),
    recordedMean: aggregateFolds("recordedHeldOut"),
    framingStability: [...stability.values()].sort((a, b) => b.folds - a.folds),
  };
}
