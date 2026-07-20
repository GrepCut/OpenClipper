import type {
  AutoFlipAspectTrack,
  ClipperLayoutMode,
  ClipperLayoutSample,
  ClipperLayoutTrack,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop";
import { importanceGeometry } from "./importance-ranker";
import {
  DEFAULT_ARBITER_PARAMS,
  coveredFraction,
  decideLayoutStrategy,
  importanceAtTime,
  interpolateBox,
  precedingIndex,
  proposalScore,
  requiredRegions,
  type ArbiterParams,
} from "./layout-arbiter";
import { smoothShotCropSamples, viewportArea } from "./shot-crop-smoothing";
import {
  createVisibilityControllerState,
  planVisibilityRescue,
  type VisibilityControllerParams,
} from "./visibility-controller";

const EPSILON = 1e-9;

export interface SemanticFramingParams {
  targetBoxSource: "box" | "contentBox";
  centerYFraction: number;
  padding: number;
  minimumScale: number;
  /** Iteration 8C: reject zoom candidates that do not fully cover required content. */
  visibilityConstrained?: boolean;
  visibilityGuardMargin?: number;
  stablePrimaryKeyframes?: number;
  allowedScales?: number[];
  scaleHysteresis?: number;
  maxCenterStep?: number;
  maxScaleStep?: number;
}

/** Promoted framing geometry. Values are global and clip-agnostic. */
export const DEFAULT_SEMANTIC_FRAMING_PARAMS: SemanticFramingParams = {
  targetBoxSource: "contentBox",
  centerYFraction: 0.44,
  padding: 0.18,
  minimumScale: 0.5,
};

/** Shadow candidate 8C. Production keeps the Run 6 path unless this is supplied explicitly. */
export const VISIBILITY_CONSTRAINED_FRAMING_PARAMS: SemanticFramingParams = {
  targetBoxSource: "box",
  centerYFraction: 0.44,
  padding: 0.08,
  minimumScale: 0.8,
  visibilityConstrained: true,
  visibilityGuardMargin: 0.08,
  stablePrimaryKeyframes: 5,
  allowedScales: [1, 0.95, 0.9, 0.8],
  scaleHysteresis: 0.025,
  maxCenterStep: 0.08,
  maxScaleStep: 0.05,
};

export interface VisibilityFramingState {
  primaryId: string | null;
  observedKeyframes: number;
  previousViewport: NormalizedBox | null;
}

export function createVisibilityFramingState(): VisibilityFramingState {
  return { primaryId: null, observedKeyframes: 0, previousViewport: null };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unionAll(boxes: NormalizedBox[]): NormalizedBox | null {
  return boxes.reduce<NormalizedBox | null>(
    (result, box) => result ? importanceGeometry.unionBoxes(result, box) : { ...box },
    null,
  );
}

function expandBox(box: NormalizedBox, margin: number): NormalizedBox {
  const x = clamp(box.x - box.width * margin, 0, 1);
  const y = clamp(box.y - box.height * margin, 0, 1);
  const right = clamp(box.x + box.width * (1 + margin), 0, 1);
  const bottom = clamp(box.y + box.height * (1 + margin), 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

function nominalCropSize(sourceAspect: number, targetAspect: number): { width: number; height: number } {
  if (sourceAspect >= targetAspect) return { width: targetAspect / sourceAspect, height: 1 };
  return { width: 1, height: sourceAspect / targetAspect };
}

function boxFitsStrictCrop(box: NormalizedBox, sourceAspect: number, targetAspect: number): boolean {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const expanded = expandBox(box, 0.08);
  return expanded.width <= nominal.width + EPSILON && expanded.height <= nominal.height + EPSILON;
}

function cropAroundBox(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale = 0.3,
  padding = 0.18,
  centerYFraction = 0.44,
): NormalizedBox {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const expanded = expandBox(box, padding);
  const scale = clamp(Math.max(
    minimumScale,
    expanded.width / Math.max(EPSILON, nominal.width),
    expanded.height / Math.max(EPSILON, nominal.height),
  ), minimumScale, 1);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * centerYFraction;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

function strictAspectViewport(
  viewport: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
): NormalizedBox {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const scale = clamp(Math.max(
    viewport.width / Math.max(EPSILON, nominal.width),
    viewport.height / Math.max(EPSILON, nominal.height),
  ), 0.05, 1);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

function centerViewportOnBox(viewport: NormalizedBox, box: NormalizedBox): NormalizedBox {
  const centerX = box.x + box.width / 2;
  // A slight upward bias preserves natural headroom for both faces and bodies.
  const centerY = box.y + box.height * 0.44;
  return {
    ...viewport,
    x: clamp(centerX - viewport.width / 2, 0, 1 - viewport.width),
    y: clamp(centerY - viewport.height / 2, 0, 1 - viewport.height),
  };
}

function containsBox(viewport: NormalizedBox, box: NormalizedBox): boolean {
  return box.x >= viewport.x - EPSILON
    && box.y >= viewport.y - EPSILON
    && box.x + box.width <= viewport.x + viewport.width + EPSILON
    && box.y + box.height <= viewport.y + viewport.height + EPSILON;
}

function viewportScale(viewport: NormalizedBox, sourceAspect: number, targetAspect: number): number {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  return Math.max(
    viewport.width / Math.max(EPSILON, nominal.width),
    viewport.height / Math.max(EPSILON, nominal.height),
  );
}

function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function viewportAtScale(
  anchor: NormalizedBox,
  guard: NormalizedBox,
  scale: number,
  sourceAspect: number,
  targetAspect: number,
  centerYFraction: number,
): NormalizedBox | null {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  if (guard.width > width + EPSILON || guard.height > height + EPSILON) return null;
  const desiredX = anchor.x + anchor.width / 2 - width / 2;
  const desiredY = anchor.y + anchor.height * centerYFraction - height / 2;
  const minimumX = Math.max(0, guard.x + guard.width - width);
  const maximumX = Math.min(1 - width, guard.x);
  const minimumY = Math.max(0, guard.y + guard.height - height);
  const maximumY = Math.min(1 - height, guard.y);
  if (minimumX > maximumX + EPSILON || minimumY > maximumY + EPSILON) return null;
  return {
    x: clamp(desiredX, minimumX, maximumX),
    y: clamp(desiredY, minimumY, maximumY),
    width,
    height,
  };
}

function limitViewportMotion(
  candidate: NormalizedBox,
  previous: NormalizedBox,
  guard: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  params: SemanticFramingParams,
): NormalizedBox | null {
  const previousScale = viewportScale(previous, sourceAspect, targetAspect);
  const candidateScale = viewportScale(candidate, sourceAspect, targetAspect);
  const maxScaleStep = params.maxScaleStep ?? 0.05;
  const scale = clamp(candidateScale, previousScale - maxScaleStep, previousScale + maxScaleStep);
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const previousCenterX = previous.x + previous.width / 2;
  const previousCenterY = previous.y + previous.height / 2;
  const candidateCenterX = candidate.x + candidate.width / 2;
  const candidateCenterY = candidate.y + candidate.height / 2;
  const deltaX = candidateCenterX - previousCenterX;
  const deltaY = candidateCenterY - previousCenterY;
  const distance = Math.hypot(deltaX, deltaY);
  const maxCenterStep = params.maxCenterStep ?? 0.08;
  const factor = distance > maxCenterStep ? maxCenterStep / distance : 1;
  const limited = {
    x: clamp(previousCenterX + deltaX * factor - width / 2, 0, 1 - width),
    y: clamp(previousCenterY + deltaY * factor - height / 2, 0, 1 - height),
    width,
    height,
  };
  return containsBox(limited, guard) ? limited : null;
}

function visibilityConstrainedViewport(
  importance: ImportanceRegionSample,
  legacyViewport: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  params: SemanticFramingParams,
  state: VisibilityFramingState,
  cut: boolean,
): NormalizedBox {
  const required = requiredRegions(importance);
  const primary = required.find((region) => region.role === "primary") ?? required[0];
  if (cut) {
    state.primaryId = null;
    state.observedKeyframes = 0;
    state.previousViewport = null;
  }
  if (!primary || required.length !== 1 || primary.predicted) {
    state.primaryId = null;
    state.observedKeyframes = 0;
    state.previousViewport = legacyViewport;
    return legacyViewport;
  }
  if (state.primaryId === primary.id) state.observedKeyframes++;
  else {
    state.primaryId = primary.id;
    state.observedKeyframes = 1;
  }
  const minimumObserved = params.stablePrimaryKeyframes ?? 5;
  if (cut || state.observedKeyframes < minimumObserved) {
    state.previousViewport = legacyViewport;
    return legacyViewport;
  }

  const guard = expandBox(primary.contentBox, params.visibilityGuardMargin ?? 0.08);
  const anchor = primary.box;
  const scales = [...new Set(params.allowedScales ?? [1, 0.95, 0.9, 0.8])]
    .filter((scale) => Number.isFinite(scale) && scale >= 0.8 && scale <= 1)
    .sort((a, b) => a - b);
  const candidates = scales
    .map((scale) => viewportAtScale(anchor, guard, scale, sourceAspect, targetAspect, params.centerYFraction))
    .filter((viewport): viewport is NormalizedBox => viewport != null && containsBox(viewport, guard));
  if (!candidates.length) {
    state.previousViewport = legacyViewport;
    return legacyViewport;
  }

  const anchorPoint = {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height * params.centerYFraction,
    width: 0,
    height: 0,
  };
  const previous = state.previousViewport;
  candidates.sort((a, b) => {
    const anchorDelta = centerDistance(a, anchorPoint) - centerDistance(b, anchorPoint);
    if (Math.abs(anchorDelta) > EPSILON) return anchorDelta;
    const compositionDelta = viewportScale(a, sourceAspect, targetAspect) - viewportScale(b, sourceAspect, targetAspect);
    if (Math.abs(compositionDelta) > EPSILON) return compositionDelta;
    if (!previous) return 0;
    const changeA = Math.abs(viewportScale(a, sourceAspect, targetAspect) - viewportScale(previous, sourceAspect, targetAspect))
      + centerDistance(a, previous);
    const changeB = Math.abs(viewportScale(b, sourceAspect, targetAspect) - viewportScale(previous, sourceAspect, targetAspect))
      + centerDistance(b, previous);
    return changeA - changeB;
  });
  let selected = candidates[0]!;
  if (previous) {
    const previousScale = viewportScale(previous, sourceAspect, targetAspect);
    const hysteresis = params.scaleHysteresis ?? 0.025;
    if (Math.abs(viewportScale(selected, sourceAspect, targetAspect) - previousScale) <= hysteresis) {
      selected = previous;
    }
    selected = limitViewportMotion(selected, previous, guard, sourceAspect, targetAspect, params) ?? legacyViewport;
  }
  if (!containsBox(selected, guard)) selected = legacyViewport;
  state.previousViewport = selected;
  return selected;
}

export function rawMode(
  sample: ImportanceRegionSample,
  sourceAspect: number,
  targetAspect: number,
): ClipperLayoutMode {
  const required = requiredRegions(sample);
  if (!required.length) return "single-crop";
  const union = unionAll(required.map((region) => region.contentBox))!;
  if (boxFitsStrictCrop(union, sourceAspect, targetAspect)) return "single-crop";
  if (required.length >= 2 && targetAspect <= 1) {
    const overlap = importanceGeometry.overlapFractionOfSmaller(required[0]!.contentBox, required[1]!.contentBox);
    if (overlap < 0.35) return "split";
  }
  return "contain";
}

interface ModeDecision {
  time: number;
  mode: ClipperLayoutMode;
  cut?: boolean;
}

function stabilizeModes(
  samples: ImportanceRegionSample[],
  sourceAspect: number,
  targetAspect: number,
): ModeDecision[] {
  let stable: ClipperLayoutMode = "single-crop";
  let pending: ClipperLayoutMode | null = null;
  let pendingCount = 0;
  return samples.map((sample, index) => {
    const desired = rawMode(sample, sourceAspect, targetAspect);
    if (index === 0 || sample.cut) {
      stable = desired;
      pending = null;
      pendingCount = 0;
    } else if (desired === stable) {
      pending = null;
      pendingCount = 0;
    } else {
      if (pending === desired) pendingCount++;
      else {
        pending = desired;
        pendingCount = 1;
      }
      const threshold = desired === "single-crop" ? 3 : 2;
      if (pendingCount >= threshold) {
        stable = desired;
        pending = null;
        pendingCount = 0;
      }
    }
    return { time: sample.time, mode: stable, cut: sample.cut };
  });
}

function modeAtTime(decisions: ModeDecision[], time: number): ClipperLayoutMode {
  if (!decisions.length) return "single-crop";
  return decisions[precedingIndex(decisions, time)]!.mode;
}

function minSubjectDisplayHeight(
  viewport: NormalizedBox,
  required: ReturnType<typeof requiredRegions>,
): number {
  if (!required.length) return 0;
  return Math.min(
    ...required.map((region) => {
      const top = Math.max(viewport.y, region.contentBox.y);
      const bottom = Math.min(viewport.y + viewport.height, region.contentBox.y + region.contentBox.height);
      const visible = Math.max(0, bottom - top);
      return visible / Math.max(EPSILON, region.contentBox.height);
    }),
  );
}

/** group-union must beat contain on area AND subject display height (handoff §3.4). */
export function groupUnionLexicographicOk(
  groupViewport: NormalizedBox,
  fallbackViewport: NormalizedBox,
  required: ReturnType<typeof requiredRegions>,
): boolean {
  const groupArea = viewportArea(groupViewport);
  const fallbackArea = viewportArea(fallbackViewport);
  if (groupArea > fallbackArea + EPSILON) return false;
  const groupHeight = minSubjectDisplayHeight(groupViewport, required);
  const fallbackHeight = minSubjectDisplayHeight(fallbackViewport, required);
  return groupHeight + EPSILON >= fallbackHeight;
}

interface GroupUnionLayout {
  mode: ClipperLayoutMode;
  viewports: NormalizedBox[];
  reasonCode: "group-union-crop" | "group-stable-split";
}

function unionBoxesForGroup(boxes: NormalizedBox[]): NormalizedBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function fitAspectViewport(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale: number,
  margin: number,
): NormalizedBox | null {
  const left = Math.max(0, box.x - box.width * margin);
  const top = Math.max(0, box.y - box.height * margin);
  const right = Math.min(1, box.x + box.width * (1 + margin));
  const bottom = Math.min(1, box.y + box.height * (1 + margin));
  const expanded = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  const normalizedAspect = targetAspect / Math.max(1e-9, sourceAspect);
  const nominal =
    normalizedAspect <= 1
      ? { width: normalizedAspect, height: 1 }
      : { width: 1, height: 1 / normalizedAspect };
  const scale = Math.max(
    minimumScale,
    expanded.width / Math.max(1e-9, nominal.width),
    expanded.height / Math.max(1e-9, nominal.height),
  );
  if (scale > 1 + 1e-9) return null;
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const minimumX = Math.max(0, expanded.x + expanded.width - width);
  const maximumX = Math.min(1 - width, expanded.x);
  const minimumY = Math.max(0, expanded.y + expanded.height - height);
  const maximumY = Math.min(1 - height, expanded.y);
  if (minimumX > maximumX + 1e-9 || minimumY > maximumY + 1e-9) return null;
  const centerX = expanded.x + expanded.width / 2;
  const centerY = expanded.y + expanded.height * 0.44;
  return {
    x: Math.max(minimumX, Math.min(maximumX, centerX - width / 2)),
    y: Math.max(minimumY, Math.min(maximumY, centerY - height / 2)),
    width,
    height,
  };
}

/** Minimal group crop; impossible 3+ geometry falls back instead of contain. */
function buildGroupUnionLayout(
  boxes: NormalizedBox[],
  sourceAspect: number,
  targetAspect: number,
  options: { minimumScale?: number; margin?: number } = {},
): GroupUnionLayout | null {
  if (boxes.length < 2) return null;
  const minimumScale = options.minimumScale ?? 0.55;
  const margin = options.margin ?? 0.08;
  const common = fitAspectViewport(
    unionBoxesForGroup(boxes),
    sourceAspect,
    targetAspect,
    minimumScale,
    margin,
  );
  if (common) {
    return {
      mode: "single-crop",
      viewports: [common],
      reasonCode: "group-union-crop",
    };
  }
  if (boxes.length !== 2) return null;
  const panels = [...boxes]
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2))
    .map((box) =>
      fitAspectViewport(
        box,
        sourceAspect,
        targetAspect * 2,
        minimumScale,
        margin,
      ),
    );
  if (!panels.every((panel): panel is NormalizedBox => panel != null))
    return null;
  return { mode: "split", viewports: panels, reasonCode: "group-stable-split" };
}

export function buildViewports(
  mode: ClipperLayoutMode,
  importance: ImportanceRegionSample,
  fallbackCrop: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  framing?: SemanticFramingParams,
  visibilityState?: VisibilityFramingState,
  cut = false,
  allowGroupUnion = false,
  groupUnionMeta?: { used: boolean },
): NormalizedBox[] {
  const required = requiredRegions(importance);
  if (mode === "contain" && !required.length) return [fallbackCrop];
  if (
    allowGroupUnion
    && mode === "single-crop"
    && required.length >= 3
    && required[0]?.kind === "action"
  ) {
    const groupUnion = buildGroupUnionLayout(
      required.map((region) => region.contentBox),
      sourceAspect,
      targetAspect,
    );
    if (groupUnion?.reasonCode === "group-union-crop") {
      if (groupUnionMeta) groupUnionMeta.used = true;
      return groupUnion.viewports;
    }
  }
  if (mode === "single-crop" || !required.length) {
    const primary = required.find((region) => region.role === "primary") ?? required[0];
    const legacyViewport = strictAspectViewport(fallbackCrop, sourceAspect, targetAspect);
    if (!primary) return [legacyViewport];
    if (!framing) return [centerViewportOnBox(legacyViewport, primary.box)];
    const legacySemanticViewport = centerViewportOnBox(legacyViewport, primary.box);
    if (framing.visibilityConstrained && visibilityState) {
      return [visibilityConstrainedViewport(
        importance,
        legacySemanticViewport,
        sourceAspect,
        targetAspect,
        framing,
        visibilityState,
        cut,
      )];
    }
    const target = framing.targetBoxSource === "contentBox" ? primary.contentBox : primary.box;
    return [cropAroundBox(
      target,
      sourceAspect,
      targetAspect,
      framing.minimumScale,
      framing.padding,
      framing.centerYFraction,
    )];
  }
  if (mode === "split" && required.length >= 2) {
    const panelAspect = targetAspect * 2;
    return [
      cropAroundBox(required[0]!.contentBox, sourceAspect, panelAspect),
      cropAroundBox(required[1]!.contentBox, sourceAspect, panelAspect),
    ];
  }
  const union = unionAll(required.map((region) => region.contentBox)) ?? required[0]!.contentBox;
  return [expandBox(union, 0.12)];
}

export interface BuildLayoutTracksInput {
  aspectTracks: Record<string, AutoFlipAspectTrack>;
  importanceSamples: ImportanceRegionSample[];
  frameWidth: number;
  frameHeight: number;
  /** Arbiter thresholds; omit for the calibrated production defaults. */
  arbiterParams?: ArbiterParams;
  /** Global semantic single-crop geometry; exposed for offline replay calibration. */
  semanticFramingParams?: SemanticFramingParams;
  /** Run 9 visibility-first rescue ladder. Omit to reproduce Run 8 exactly. */
  visibilityControllerParams?: VisibilityControllerParams;
}

/** Builds stable format-aware render decisions over the smooth legacy camera path. */
export function buildLayoutTracks(input: BuildLayoutTracksInput): Record<string, ClipperLayoutTrack> {
  const sourceAspect = input.frameWidth / Math.max(1, input.frameHeight);
  const arbiterParams = input.arbiterParams ?? DEFAULT_ARBITER_PARAMS;
  return Object.fromEntries(Object.entries(input.aspectTracks).map(([formatId, aspectTrack]) => {
    const visibilityState = createVisibilityFramingState();
    const visibilityControllerState = createVisibilityControllerState();
    const samples: ClipperLayoutSample[] = aspectTrack.samples.map((cropSample) => {
      const importance = importanceAtTime(input.importanceSamples, cropSample.t);
      const fallbackPixelAspect = cropSample.crop.width * sourceAspect / Math.max(EPSILON, cropSample.crop.height);
      const explicitPadding = cropSample.solidBackgroundColor != null
        && Math.abs(fallbackPixelAspect - aspectTrack.targetAspectRatio) > 0.001;
      const required = requiredRegions(importance);
      const baselineMode: ClipperLayoutMode = explicitPadding
        || Math.abs(fallbackPixelAspect - aspectTrack.targetAspectRatio) > 0.001
        ? "contain"
        : "single-crop";
      const baselineViewports = [cropSample.crop];
      const importanceIndex = precedingIndex(input.importanceSamples, cropSample.t);
      let desiredMode = rawMode(importance, sourceAspect, aspectTrack.targetAspectRatio);
      const groupUnionMeta = { used: false };
      let semanticViewports = buildViewports(
        desiredMode,
        importance,
        cropSample.crop,
        sourceAspect,
        aspectTrack.targetAspectRatio,
        input.semanticFramingParams,
        visibilityState,
        Boolean(cropSample.cut),
        Boolean(arbiterParams.allowGroupUnion),
        groupUnionMeta,
      );
      if (groupUnionMeta.used) {
        const fallbackViewports = buildViewports(
          desiredMode,
          importance,
          cropSample.crop,
          sourceAspect,
          aspectTrack.targetAspectRatio,
          input.semanticFramingParams,
          visibilityState,
          Boolean(cropSample.cut),
          false,
        );
        if (!groupUnionLexicographicOk(semanticViewports[0]!, fallbackViewports[0]!, required)) {
          semanticViewports = fallbackViewports;
        }
      }
      const visibilityDecision = input.visibilityControllerParams?.enabled
        ? planVisibilityRescue({
            samples: input.importanceSamples,
            importanceIndex,
            baselineViewport: baselineViewports[0]!,
            sourceAspect,
            targetAspect: aspectTrack.targetAspectRatio,
            state: visibilityControllerState,
            params: input.visibilityControllerParams,
          })
        : null;
      if (visibilityDecision) {
        desiredMode = visibilityDecision.mode;
        semanticViewports = visibilityDecision.viewports;
      }
      const coverageRegions = visibilityDecision?.envelopes ?? required;
      const baselineScore = proposalScore(baselineViewports, coverageRegions);
      const semanticScore = proposalScore(semanticViewports, coverageRegions);
      const decision = decideLayoutStrategy({
        desiredMode,
        baselineScore,
        semanticScore,
        controllerReasonCodes: visibilityDecision?.reasonCodes,
      }, arbiterParams);
      return {
        t: cropSample.t,
        mode: decision.selectSemantic ? desiredMode : baselineMode,
        strategy: decision.strategy,
        viewports: decision.selectSemantic ? semanticViewports : baselineViewports,
        candidateMode: desiredMode,
        candidateViewports: semanticViewports,
        baselineViewports,
        primaryRegionId: required.find((region) => region.role === "primary")?.id,
        requiredRegionIds: required.map((region) => region.id),
        baselineScore,
        semanticScore,
        decisionConfidence: decision.decisionConfidence,
        reasonCodes: decision.reasonCodes,
        candidateVariants: visibilityDecision?.variants,
        baselineRequiredCoverage: visibilityDecision?.baselineCoverage,
        selectedRequiredCoverage: decision.selectSemantic
          ? visibilityDecision?.selectedCoverage
          : visibilityDecision?.baselineCoverage,
        visibilityRisk: visibilityDecision?.visibilityRisk,
        qualityTelemetry: visibilityDecision ? {
          containDutyCandidate: decision.selectSemantic && desiredMode === "contain",
          subjectDisplayHeightFractions: coverageRegions.map((region) => Math.min(1, Math.max(
            ...((decision.selectSemantic ? semanticViewports : baselineViewports).map((viewport) =>
              region.contentBox.height / Math.max(EPSILON, viewport.height))),
          ))),
        } : undefined,
        coverageBoxes: coverageRegions.map((region) => ({ ...region.contentBox })),
        cut: cropSample.cut,
        solidBackgroundColor: cropSample.solidBackgroundColor,
      };
    });
    return [formatId, { targetAspectRatio: aspectTrack.targetAspectRatio, samples }];
  }));
}

export function resolveLayoutTrack(
  tracks: Record<string, ClipperLayoutTrack> | undefined,
  formatId: string,
): ClipperLayoutTrack | null {
  return tracks?.[formatId] ?? tracks?.default ?? null;
}

/** Interpolates camera geometry but never blends across a cut or a layout-mode change. */
export function interpolateLayoutSample(
  track: ClipperLayoutTrack | null,
  time: number,
): ClipperLayoutSample | null {
  if (!track?.samples.length) return null;
  const index = precedingIndex(track.samples.map((sample) => ({ ...sample, time: sample.t })), time);
  const previous = track.samples[index]!;
  const next = track.samples[index + 1];
  if (!next || next.cut || next.mode !== previous.mode || next.strategy !== previous.strategy || next.viewports.length !== previous.viewports.length) {
    return { ...previous, t: time };
  }
  const factor = clamp((time - previous.t) / Math.max(EPSILON, next.t - previous.t), 0, 1);
  const interpolatedViewports = previous.viewports.map((viewport, viewportIndex) =>
    interpolateBox(viewport, next.viewports[viewportIndex]!, factor));
  const previousCoverageBoxes = previous.coverageBoxes;
  const nextCoverageBoxes = next.coverageBoxes;
  const interpolatedCoverageBoxes = previousCoverageBoxes?.length === nextCoverageBoxes?.length
    ? previousCoverageBoxes?.map((box, index) => interpolateBox(box, nextCoverageBoxes![index]!, factor))
    : previous.coverageBoxes;
  const interpolationSafe = !interpolatedCoverageBoxes?.length || interpolatedCoverageBoxes.every((box) =>
    interpolatedViewports.some((viewport) => coveredFraction(viewport, box) >= 1 - EPSILON));
  if (!interpolationSafe) return { ...previous, t: time, reasonCodes: [...(previous.reasonCodes ?? []), "interpolation-hold-coverage"] };
  return {
    ...previous,
    t: time,
    viewports: interpolatedViewports,
    candidateViewports: previous.candidateViewports?.length === next.candidateViewports?.length
      ? previous.candidateViewports?.map((viewport, viewportIndex) =>
          interpolateBox(viewport, next.candidateViewports![viewportIndex]!, factor))
      : previous.candidateViewports,
  };
}

export const layoutGeometry = {
  boxFitsStrictCrop,
  centerViewportOnBox,
  cropAroundBox,
  nominalCropSize,
  strictAspectViewport,
};
