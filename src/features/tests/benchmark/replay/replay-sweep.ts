import { DEFAULT_ARBITER_PARAMS, type ArbiterParams } from "../../../clipper/engine/autoflip/layout-arbiter";
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
  overall: AggregateMetrics;
  perClip: ClipReplayResult[];
  /** Deltas vs the recorded selected metrics of the source run, in rate units. */
  worstFocusDelta: number;
  worstVisibilityDelta: number;
  /** Clips where focus AND visibility both dropped by more than 10 pp. */
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

/** Run5 recorded 9:16 aggregate — the promotion floor for this iteration. */
export const RUN5_PORTRAIT_FLOOR: GateThresholds = {
  minFocus: 0.6635168226198993,
  minVisibility: 0.9088142000737887,
  minDual: 0.350063482044689,
};

export function evaluateParams(
  clips: ClipArtifacts[],
  params: ArbiterParams,
  gatesAt: GateThresholds = RUN5_PORTRAIT_FLOOR,
): EvaluatedParams {
  const perClip = clips.map((clip) => replayClip(clip, params));
  const overall = aggregate(perClip);
  let worstFocusDelta = 0;
  let worstVisibilityDelta = 0;
  const catastrophicClips: string[] = [];
  const regressedClips: string[] = [];
  for (const [index, result] of perClip.entries()) {
    const recorded = clips[index]!.comparison.selected;
    const focusDelta = result.metrics.focusHitRate - recorded.focusHitRate;
    const visibilityDelta = result.metrics.targetVisibilityRate - recorded.targetVisibilityRate;
    worstFocusDelta = Math.min(worstFocusDelta, focusDelta);
    worstVisibilityDelta = Math.min(worstVisibilityDelta, visibilityDelta);
    if (focusDelta < -0.1 && visibilityDelta < -0.1) catastrophicClips.push(result.clipName);
    else if (focusDelta < -0.05 || visibilityDelta < -0.05) regressedClips.push(result.clipName);
  }
  const reasons: string[] = [];
  if (overall.focusHit < gatesAt.minFocus) reasons.push(`focus ${(overall.focusHit * 100).toFixed(2)} < ${(gatesAt.minFocus * 100).toFixed(2)}`);
  if (overall.visibility < gatesAt.minVisibility) reasons.push(`visibility ${(overall.visibility * 100).toFixed(2)} < ${(gatesAt.minVisibility * 100).toFixed(2)}`);
  if ((overall.dualAllVisible ?? 0) < gatesAt.minDual) reasons.push(`dual ${((overall.dualAllVisible ?? 0) * 100).toFixed(2)} < ${(gatesAt.minDual * 100).toFixed(2)}`);
  if (catastrophicClips.length) reasons.push(`catastrophic: ${catastrophicClips.join(", ")}`);
  return {
    params,
    overall,
    perClip,
    worstFocusDelta,
    worstVisibilityDelta,
    catastrophicClips,
    regressedClips,
    gates: { passed: reasons.length === 0, reasons },
  };
}

/** Gate-first objective: among gate-passing sets prefer focus, then dual, then visibility. */
export function compareByObjective(a: EvaluatedParams, b: EvaluatedParams): number {
  if (a.gates.passed !== b.gates.passed) return a.gates.passed ? -1 : 1;
  if (a.overall.focusHit !== b.overall.focusHit) return b.overall.focusHit - a.overall.focusHit;
  const dualA = a.overall.dualAllVisible ?? 0;
  const dualB = b.overall.dualAllVisible ?? 0;
  if (dualA !== dualB) return dualB - dualA;
  return b.overall.visibility - a.overall.visibility;
}

export function sweep(
  clips: ClipArtifacts[],
  paramSets: ArbiterParams[],
  gatesAt: GateThresholds = RUN5_PORTRAIT_FLOOR,
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
  gatesAt: GateThresholds = RUN5_PORTRAIT_FLOOR,
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
