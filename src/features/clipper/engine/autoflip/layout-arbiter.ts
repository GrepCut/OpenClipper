import type {
  ClipperLayoutMode,
  ClipperLayoutStrategy,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop";
import { importanceGeometry } from "./importance-ranker";

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Every tunable threshold of the layout arbiter. Defaults reproduce the
 * Run5 (`autoflip-v14-hybrid-arbiter`) behavior exactly; the offline replay
 * tool sweeps these against recorded benchmark artifacts before any value
 * is promoted into DEFAULT_ARBITER_PARAMS.
 */
export interface ArbiterParams {
  /** Minimum semantic-over-baseline proposal-score advantage. */
  proposalMargin: number;
  /** Minimum importance score of the primary region. */
  minPrimaryImportance: number;
  /** Confidence floor when a face/head/active-speaker source confirms the primary. */
  faceConfidence: number;
  /** Confidence floor when multiple distinct semantic sources confirm the primary. */
  multiSourceConfidence: number;
  /** Distinct semantic sources needed for the multi-source reliability path. */
  minSemanticSourceCount: number;
  /** Identical required-id sets needed across consecutive keyframes. */
  stabilityKeyframes: number;
  /** Detector dropout tolerated inside the stability window, seconds. */
  dropoutToleranceSec: number;
  /** Confidence floor for each subject of a dual (split) proposal. */
  dualConfidence: number;
  /** Importance floor for each subject of a dual (split) proposal. */
  dualImportance: number;
  /** Divisor mapping proposal margin to decisionConfidence. */
  decisionConfidenceScale: number;
  /** Per-camera-motion-type margin overrides; falls back to proposalMargin. */
  proposalMarginByMotionType?: Partial<Record<string, number>>;
  /**
   * Every required region's contentBox must be covered by the semantic
   * viewports at least this much. 0 disables the guard (visibility proxy).
   */
  minRequiredContentCoverage?: number;
  /** Primary subject must have been observed at least this long. 0 disables. */
  minSubjectLifetimeSec?: number;
  /**
   * Strongest non-required competitor may reach at most this fraction of the
   * primary's importance. Disabled when omitted.
   */
  maxCompetitorImportanceRatio?: number;
  /** Allow split proposals to win arbitration (Run5: shadow-only). */
  allowSplit?: boolean;
  /** Allow contain proposals to win arbitration (Run5: shadow-only). */
  allowContain?: boolean;
  /** Run 9: compare hard per-target coverage before any composition score. */
  visibilityFirst?: boolean;
  /** Numerical tolerance for the no-regression coverage comparison. */
  coverageEpsilon?: number;
  /** Selects Iteration 10's canonical split/state-machine policy in replay. */
  iteration10?: boolean;
}

/**
 * Run6 calibration (offline replay of Run5 artifacts, leave-one-clip-out
 * validated): lowering the proposal margin to 0.075 while demanding one extra
 * stability keyframe captures most of the semantic candidate's focus upside
 * (replay: 9:16 focus 66.35% → 69.25%) without losing visibility (90.88% →
 * 90.90%). Margins below 0.075 or 4-keyframe stability dip visibility under
 * the Run5 floor. Split/contain stay shadow-only: replaying their activation
 * lost both dual visibility (35.0% → 33.5%) and overall visibility.
 */
export const DEFAULT_ARBITER_PARAMS: Readonly<ArbiterParams> = Object.freeze({
  proposalMargin: 0.075,
  minPrimaryImportance: 0.9,
  faceConfidence: 0.82,
  multiSourceConfidence: 0.75,
  minSemanticSourceCount: 2,
  stabilityKeyframes: 5,
  dropoutToleranceSec: 0.8,
  dualConfidence: 0.75,
  dualImportance: 0.75,
  decisionConfidenceScale: 0.3,
});

/** Run 9 candidate policy. Production keeps DEFAULT_ARBITER_PARAMS until gates pass. */
export const RUN9_ARBITER_PARAMS: Readonly<ArbiterParams> = Object.freeze({
  ...DEFAULT_ARBITER_PARAMS,
  stabilityKeyframes: 3,
  minRequiredContentCoverage: 0.98,
  allowSplit: true,
  allowContain: true,
  visibilityFirst: true,
  coverageEpsilon: 1e-6,
});

export const RUN10_ARBITER_PARAMS: Readonly<ArbiterParams> = Object.freeze({
  ...RUN9_ARBITER_PARAMS,
  iteration10: true,
});

/** Camera-motion classification of one analyzed scene for one output format. */
export interface ArbiterSceneMotion {
  formatId: string;
  start: number;
  end: number;
  motionType: string;
}

/**
 * Everything the arbiter may look at for one layout sample. Deliberately
 * contains no ground-truth or clip-identity fields: the same context is
 * reconstructed from recorded artifacts by the offline replay tool, and the
 * type is the enforcement boundary against training-only features.
 */
export interface ArbiterSampleContext {
  t: number;
  cut: boolean;
  explicitPadding: boolean;
  desiredMode: ClipperLayoutMode;
  required: ImportanceRegion[];
  baselineScore: number;
  semanticScore: number;
  semanticViewports: NormalizedBox[];
  /** Exact Run 8 viewports used by the hard Run 9 coverage comparator. */
  baselineViewports?: NormalizedBox[];
  /** Motion/lookahead envelopes. Omitted for historical replay artifacts. */
  coverageRegions?: ImportanceRegion[];
  /** Controller diagnostics persisted alongside the final decision. */
  controllerReasonCodes?: string[];
  /** Lookahead says Run 8 will lose coverage even if current coverage ties. */
  visibilityRisk?: boolean;
  importanceSamples: ImportanceRegionSample[];
  importanceIndex: number;
  motionType?: string;
}

export interface ArbiterDecision {
  selectSemantic: boolean;
  strategy: ClipperLayoutStrategy;
  reasonCodes: string[];
  decisionConfidence: number;
}

export function requiredRegions(sample: ImportanceRegionSample): ImportanceRegion[] {
  return sample.regions.filter((region) => region.required).slice(0, 2);
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
  if (!samples.length) return { time, regions: [] };
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
  return { time, regions, cut: previous.cut };
}

function semanticSources(region: ImportanceRegion): string[] {
  return region.sources.filter((source) => source !== "motion");
}

export function isReliablePrimary(region: ImportanceRegion, params: ArbiterParams): boolean {
  const sources = semanticSources(region);
  const faceConfirmed = sources.some((source) => source === "face" || source === "head" || source === "active-speaker");
  return !region.predicted
    && region.importanceScore >= params.minPrimaryImportance
    && ((faceConfirmed && region.confidence >= params.faceConfidence)
      || (new Set(sources).size >= params.minSemanticSourceCount && region.confidence >= params.multiSourceConfidence));
}

export function stableRequiredIds(
  samples: ImportanceRegionSample[],
  index: number,
  params: ArbiterParams,
): boolean {
  const current = requiredRegions(samples[index]!);
  if (!current.length) return false;
  const ids = current.map((region) => region.id).sort().join("|");
  let matching = 1;
  const currentTime = samples[index]!.time;
  for (let cursor = index - 1; cursor >= 0 && matching < params.stabilityKeyframes; cursor--) {
    const sample = samples[cursor]!;
    if (samples[cursor + 1]!.cut || sample.cut) break;
    const prior = requiredRegions(sample);
    if (!prior.length && currentTime - sample.time <= params.dropoutToleranceSec + EPSILON) continue;
    const priorIds = prior.map((region) => region.id).sort().join("|");
    if (priorIds !== ids) break;
    matching++;
  }
  return matching >= params.stabilityKeyframes;
}

/**
 * Seconds the primary subject id has been continuously observed before `index`,
 * tolerating detector dropouts up to `dropoutToleranceSec` and never crossing
 * a shot boundary.
 */
export function subjectLifetimeSec(
  samples: ImportanceRegionSample[],
  index: number,
  primaryId: string,
  params: ArbiterParams,
): number {
  const currentTime = samples[index]?.time ?? 0;
  let firstSeen = currentTime;
  let lastSeen = currentTime;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const sample = samples[cursor]!;
    if (samples[cursor + 1]!.cut || sample.cut) break;
    if (sample.regions.some((region) => region.id === primaryId)) {
      firstSeen = sample.time;
      lastSeen = sample.time;
    } else if (lastSeen - sample.time > params.dropoutToleranceSec + EPSILON) {
      break;
    }
  }
  return currentTime - firstSeen;
}

function effectiveProposalMargin(ctx: ArbiterSampleContext, params: ArbiterParams): number {
  if (ctx.motionType && params.proposalMarginByMotionType) {
    const override = params.proposalMarginByMotionType[ctx.motionType];
    if (override != null) return override;
  }
  return params.proposalMargin;
}

function requiredContentCovered(ctx: ArbiterSampleContext, threshold: number): boolean {
  const required = ctx.coverageRegions ?? ctx.required;
  return required.every((region) =>
    Math.max(0, ...ctx.semanticViewports.map((viewport) => coveredFraction(viewport, region.contentBox))) >= threshold - EPSILON);
}

function coverageComparison(ctx: ArbiterSampleContext, epsilon: number): {
  noRegression: boolean;
  visibilityGain: boolean;
} {
  if (!ctx.baselineViewports?.length) return { noRegression: true, visibilityGain: false };
  const required = ctx.coverageRegions ?? ctx.required;
  let visibilityGain = false;
  for (const region of required) {
    const baseline = Math.max(0, ...ctx.baselineViewports.map((viewport) => coveredFraction(viewport, region.contentBox)));
    const semantic = Math.max(0, ...ctx.semanticViewports.map((viewport) => coveredFraction(viewport, region.contentBox)));
    if (semantic + epsilon < baseline) return { noRegression: false, visibilityGain: false };
    if (semantic > baseline + epsilon) visibilityGain = true;
  }
  return { noRegression: true, visibilityGain };
}

function competitorRatio(ctx: ArbiterSampleContext, primary: ImportanceRegion): number {
  const importance = ctx.importanceSamples[ctx.importanceIndex];
  if (!importance) return 0;
  const requiredIds = new Set(ctx.required.map((region) => region.id));
  const competitor = Math.max(
    0,
    ...importance.regions.filter((region) => !requiredIds.has(region.id)).map((region) => region.importanceScore),
  );
  return competitor / Math.max(EPSILON, primary.importanceScore);
}

/**
 * Pure per-sample arbitration between the Run4 legacy baseline and the
 * semantic proposal. With DEFAULT_ARBITER_PARAMS this reproduces the Run5
 * decision (strategy, reason codes, and confidence) bit for bit.
 */
export function decideLayoutStrategy(ctx: ArbiterSampleContext, params: ArbiterParams): ArbiterDecision {
  const stable = ctx.importanceSamples.length > 0
    && stableRequiredIds(ctx.importanceSamples, ctx.importanceIndex, params);
  const primary = ctx.required.find((region) => region.role === "primary") ?? ctx.required[0];
  const dualReliable = ctx.desiredMode === "split"
    && ctx.required.length === 2
    && ctx.required.every((region) =>
      !region.predicted && region.confidence >= params.dualConfidence && region.importanceScore >= params.dualImportance);
  const reliable = Boolean(primary && isReliablePrimary(primary, params) && (ctx.desiredMode !== "split" || dualReliable));
  const improvement = ctx.semanticScore - ctx.baselineScore;
  const margin = effectiveProposalMargin(ctx, params);
  const modeAllowed = ctx.desiredMode === "single-crop"
    || (ctx.desiredMode === "split" && params.allowSplit === true)
    || (ctx.desiredMode === "contain" && params.allowContain === true);

  const coverageThreshold = params.minRequiredContentCoverage ?? 0;
  const coverageOk = coverageThreshold <= 0 || requiredContentCovered(ctx, coverageThreshold);
  const coverageOrder = coverageComparison(ctx, params.coverageEpsilon ?? 1e-6);
  const lifetimeThreshold = params.minSubjectLifetimeSec ?? 0;
  const lifetimeOk = lifetimeThreshold <= 0
    || (primary != null
      && subjectLifetimeSec(ctx.importanceSamples, ctx.importanceIndex, primary.id, params) >= lifetimeThreshold - EPSILON);
  const competitorOk = params.maxCompetitorImportanceRatio == null
    || (primary != null && competitorRatio(ctx, primary) <= params.maxCompetitorImportanceRatio + EPSILON);
  // Iteration 10's visibility controller already validates identity, applies
  // hysteresis, and enforces a per-scene switch budget before choosing the
  // least-invasive safe variant. Reapplying the older semantic-evidence gates
  // here can discard that stateful decision in favour of a less-visible
  // baseline crop.
  const controllerApproved = params.iteration10 === true && ctx.controllerReasonCodes != null;

  const objectiveOk = params.visibilityFirst
    ? coverageOrder.noRegression && (coverageOrder.visibilityGain || ctx.visibilityRisk === true || improvement >= margin)
    : improvement >= margin;
  const selectSemantic =
    modeAllowed &&
    (controllerApproved || (!ctx.cut
      && !ctx.explicitPadding
      && stable
      && reliable
      && objectiveOk
      && coverageOk
      && lifetimeOk
      && competitorOk));

  const strategy: ClipperLayoutStrategy = selectSemantic
    ? ctx.desiredMode === "split"
      ? "semantic-split"
      : ctx.desiredMode === "contain"
        ? "semantic-contain"
        : "semantic-single"
    : "legacy-baseline";

  const reasonCodes = selectSemantic
    ? controllerApproved
      ? ["visibility-controller", ...(ctx.controllerReasonCodes ?? [])]
      : [
          "stable-semantic-target",
          ...(params.visibilityFirst && (coverageOrder.visibilityGain || ctx.visibilityRisk)
            ? [
                ctx.visibilityRisk && !coverageOrder.visibilityGain
                  ? "predicted-visibility-risk"
                  : "visibility-coverage-gain",
              ]
            : ["proposal-margin"]),
          ...(ctx.controllerReasonCodes ?? []),
        ]
    : [
        ...(ctx.cut ? ["shot-boundary"] : []),
        ...(ctx.explicitPadding ? ["baseline-padding"] : []),
        ...(!stable ? ["unstable-target"] : []),
        ...(!reliable ? ["insufficient-semantic-evidence"] : []),
        ...(!objectiveOk && !coverageOrder.noRegression ? ["coverage-regression-vs-run8"] : []),
        ...(!objectiveOk && coverageOrder.noRegression ? ["insufficient-proposal-margin"] : []),
        ...(!coverageOk ? ["insufficient-content-coverage"] : []),
        ...(!lifetimeOk ? ["short-subject-lifetime"] : []),
        ...(!competitorOk ? ["ambiguous-competitor"] : []),
      ];

  return {
    selectSemantic,
    strategy,
    reasonCodes,
    decisionConfidence: clamp(Math.max(0, improvement) / params.decisionConfidenceScale, 0, 1),
  };
}

/** Motion type of the scene covering `time` for `formatId`, if recorded. */
export function motionTypeAt(
  sceneMotion: ArbiterSceneMotion[] | undefined,
  formatId: string,
  time: number,
): string | undefined {
  return sceneMotion?.find((scene) =>
    scene.formatId === formatId && time >= scene.start - EPSILON && time < scene.end + EPSILON)?.motionType;
}
