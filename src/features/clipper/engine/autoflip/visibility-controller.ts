import type {
  ClipperLayoutMode,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop";
import { coveredFraction, requiredRegions } from "./layout-arbiter";
import { importanceGeometry } from "./importance-ranker";

const EPSILON = 1e-9;

export interface VisibilityControllerParams {
  enabled: boolean;
  lookaheadSec: number;
  envelopeMargin: number;
  velocityMarginSec: number;
  edgeRiskFraction: number;
  widerHoldSec: number;
  splitStableSamples: number;
  splitMinDurationSec: number;
  splitExitStableSec: number;
  containMinDurationSec: number;
  containMaxDurationSec: number;
  splitPendingSec?: number;
  mergePendingSec?: number;
  splitVariant?: "v2" | "v3";
  minimumAssociationConfidence?: number;
  maxSwitchesPerMinute?: number;
  riskMergeGapSec?: number;
  identityHoldSec?: number;
}

export const RUN9_VISIBILITY_CONTROLLER_PARAMS: Readonly<VisibilityControllerParams> = Object.freeze({
  enabled: true,
  lookaheadSec: 0.8,
  envelopeMargin: 0.08,
  velocityMarginSec: 0.25,
  edgeRiskFraction: 0.12,
  widerHoldSec: 0.8,
  splitStableSamples: 3,
  splitMinDurationSec: 1,
  splitExitStableSec: 0.8,
  containMinDurationSec: 0.6,
  containMaxDurationSec: 2,
});

export const ITERATION10_VISIBILITY_CONTROLLER_PARAMS: Readonly<VisibilityControllerParams> = Object.freeze({
  ...RUN9_VISIBILITY_CONTROLLER_PARAMS,
  splitStableSamples: 3,
  splitPendingSec: 0.6,
  splitMinDurationSec: 1.5,
  splitExitStableSec: 1.2,
  mergePendingSec: 1.2,
  splitVariant: "v3",
  minimumAssociationConfidence: 0.75,
  maxSwitchesPerMinute: 6,
  riskMergeGapSec: 0.4,
  identityHoldSec: 0.6,
  widerHoldSec: 1.2,
});

export type VisibilityMachineState = "common" | "split-pending" | "split-active" | "merge-pending" | "contain-failsafe";

export interface VisibilityControllerState {
  scene: number;
  activeMode: ClipperLayoutMode;
  modeSince: number;
  riskClearedAt: number | null;
  lastRiskAt: number | null;
  panelOrder: string[];
  previousViewport: NormalizedBox | null;
  machineState: VisibilityMachineState;
  pendingSince: number | null;
  lastSplitViewports: NormalizedBox[];
  identityLostAt: number | null;
  modeSwitchTimestamps: number[];
  sceneStartedAt: number;
}

export function createVisibilityControllerState(): VisibilityControllerState {
  return {
    scene: 0,
    activeMode: "single-crop",
    modeSince: Number.NEGATIVE_INFINITY,
    riskClearedAt: null,
    lastRiskAt: null,
    panelOrder: [],
    previousViewport: null,
    machineState: "common",
    pendingSince: null,
    lastSplitViewports: [],
    identityLostAt: null,
    modeSwitchTimestamps: [],
    sceneStartedAt: 0,
  };
}

export interface VisibilityVariant {
  kind: "run8-baseline" | "shifted-crop" | "wider-crop" | "stable-split-v2" | "stable-split-v3" | "contain-fail-safe";
  mode: ClipperLayoutMode;
  viewports: NormalizedBox[];
  requiredCoverage: number[];
}

export interface VisibilityControllerDecision {
  mode: ClipperLayoutMode;
  viewports: NormalizedBox[];
  envelopes: ImportanceRegion[];
  variants: VisibilityVariant[];
  baselineCoverage: number[];
  selectedCoverage: number[];
  reasonCodes: string[];
  visibilityRisk: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function nominalCropSize(sourceAspect: number, targetAspect: number): { width: number; height: number } {
  if (sourceAspect >= targetAspect) return { width: targetAspect / sourceAspect, height: 1 };
  return { width: 1, height: sourceAspect / targetAspect };
}

function expand(box: NormalizedBox, marginX: number, marginY = marginX): NormalizedBox {
  const x = clamp(box.x - marginX, 0, 1);
  const y = clamp(box.y - marginY, 0, 1);
  const right = clamp(box.x + box.width + marginX, 0, 1);
  const bottom = clamp(box.y + box.height + marginY, 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

function union(boxes: NormalizedBox[]): NormalizedBox | null {
  return boxes.reduce<NormalizedBox | null>(
    (result, box) => result ? importanceGeometry.unionBoxes(result, box) : { ...box },
    null,
  );
}

function coverage(viewports: NormalizedBox[], regions: ImportanceRegion[]): number[] {
  return regions.map((region) => Math.max(0, ...viewports.map((viewport) => coveredFraction(viewport, region.contentBox))));
}

function coversAll(values: number[], threshold = 1 - EPSILON): boolean {
  return values.length > 0 && values.every((value) => value >= threshold);
}

function fitViewport(
  anchor: NormalizedBox,
  width: number,
  height: number,
  preferredCenter?: { x: number; y: number },
): NormalizedBox | null {
  if (anchor.width > width + EPSILON || anchor.height > height + EPSILON) return null;
  const minimumX = Math.max(0, anchor.x + anchor.width - width);
  const maximumX = Math.min(1 - width, anchor.x);
  const minimumY = Math.max(0, anchor.y + anchor.height - height);
  const maximumY = Math.min(1 - height, anchor.y);
  if (minimumX > maximumX + EPSILON || minimumY > maximumY + EPSILON) return null;
  const center = preferredCenter ?? {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height * 0.44,
  };
  return {
    x: clamp(center.x - width / 2, minimumX, maximumX),
    y: clamp(center.y - height / 2, minimumY, maximumY),
    width,
    height,
  };
}

function cropForEnvelope(
  envelope: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale: number,
): NormalizedBox | null {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const scale = clamp(Math.max(
    minimumScale,
    envelope.width / Math.max(EPSILON, nominal.width),
    envelope.height / Math.max(EPSILON, nominal.height),
  ), minimumScale, 1);
  return fitViewport(envelope, nominal.width * scale, nominal.height * scale);
}

function findPreviousRegion(
  samples: ImportanceRegionSample[],
  index: number,
  id: string,
): { region: ImportanceRegion; time: number } | null {
  const currentTime = samples[index]?.time ?? 0;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const sample = samples[cursor]!;
    if (samples[cursor + 1]?.cut || sample.cut || currentTime - sample.time > 0.6) break;
    const region = sample.regions.find((candidate) => candidate.id === id && !candidate.predicted);
    if (region) return { region, time: sample.time };
  }
  return null;
}

/** Builds a motion-aware envelope from observed evidence and same-scene offline lookahead. */
export function buildVisibilityEnvelopes(
  samples: ImportanceRegionSample[],
  index: number,
  params: VisibilityControllerParams,
): ImportanceRegion[] {
  const sample = samples[index] ?? { time: 0, regions: [] };
  return requiredRegions(sample).map((region) => {
    let contentBox = { ...region.contentBox };
    const previous = findPreviousRegion(samples, index, region.id);
    const currentCenterX = region.contentBox.x + region.contentBox.width / 2;
    const currentCenterY = region.contentBox.y + region.contentBox.height / 2;
    let speedX = 0;
    let speedY = 0;
    if (previous && sample.time > previous.time + EPSILON) {
      const dt = sample.time - previous.time;
      speedX = (currentCenterX - (previous.region.contentBox.x + previous.region.contentBox.width / 2)) / dt;
      speedY = (currentCenterY - (previous.region.contentBox.y + previous.region.contentBox.height / 2)) / dt;
    }
    for (let cursor = index + 1; cursor < samples.length; cursor++) {
      const future = samples[cursor]!;
      if (future.cut || future.time - sample.time > params.lookaheadSec + EPSILON) break;
      const next = future.regions.find((candidate) => candidate.id === region.id);
      if (next) contentBox = importanceGeometry.unionBoxes(contentBox, next.contentBox);
    }
    const speedMarginX = Math.min(0.12, Math.abs(speedX) * params.velocityMarginSec);
    const speedMarginY = Math.min(0.08, Math.abs(speedY) * params.velocityMarginSec);
    contentBox = expand(
      contentBox,
      params.envelopeMargin * Math.max(0.02, region.contentBox.width) + speedMarginX,
      params.envelopeMargin * Math.max(0.02, region.contentBox.height) + speedMarginY,
    );
    return { ...region, contentBox };
  });
}

function hasIndependentEvidence(region: ImportanceRegion): boolean {
  const semantic = new Set(region.sources.filter((source) => source !== "motion"));
  return !region.predicted
    && region.confidence >= 0.75
    && !region.identityAmbiguous
    && (semantic.has("person") || semantic.has("pose") || semantic.has("face") || semantic.has("head"));
}

function stablePair(
  samples: ImportanceRegionSample[],
  index: number,
  ids: string[],
  minimumSamples: number,
): boolean {
  if (ids.length !== 2) return false;
  const key = [...ids].sort().join("|");
  let observed = 0;
  for (let cursor = index; cursor >= 0 && observed < minimumSamples; cursor--) {
    const sample = samples[cursor]!;
    if (cursor < index && (samples[cursor + 1]?.cut || sample.cut)) break;
    const required = requiredRegions(sample).filter(hasIndependentEvidence);
    if (required.length !== 2 || required.map((region) => region.id).sort().join("|") !== key) break;
    observed++;
  }
  return observed >= minimumSamples;
}

function similarlyImportantPeople(sample: ImportanceRegionSample): number {
  const human = new Set(["face", "head", "speaker", "person"]);
  const candidates = sample.regions.filter((region) => !region.predicted && human.has(region.kind));
  if (candidates.length < 3) return candidates.length;
  const strongest = Math.max(...candidates.map((region) => region.importanceScore));
  return candidates.filter((region) => region.importanceScore >= strongest * 0.8).length;
}

function edgeRisk(
  samples: ImportanceRegionSample[],
  index: number,
  regions: ImportanceRegion[],
  fraction: number,
): boolean {
  const previous = new Map<string, ImportanceRegion>();
  if (index > 0 && !samples[index]?.cut) {
    for (const region of samples[index - 1]!.regions) previous.set(region.id, region);
  }
  return regions.some((region) => {
    const center = region.contentBox.x + region.contentBox.width / 2;
    const prior = previous.get(region.id);
    const priorCenter = prior ? prior.contentBox.x + prior.contentBox.width / 2 : center;
    return (center <= fraction && center < priorCenter - EPSILON)
      || (center >= 1 - fraction && center > priorCenter + EPSILON);
  });
}

function orderedPair(regions: ImportanceRegion[], state: VisibilityControllerState): ImportanceRegion[] {
  if (state.panelOrder.length === 2) {
    const ordered = state.panelOrder
      .map((id) => regions.find((region) => region.id === id))
      .filter((region): region is ImportanceRegion => region != null);
    if (ordered.length === 2) return ordered;
  }
  const ordered = [...regions].sort((a, b) =>
    (a.contentBox.x + a.contentBox.width / 2) - (b.contentBox.x + b.contentBox.width / 2));
  state.panelOrder = ordered.map((region) => region.id);
  return ordered;
}

function variant(
  kind: VisibilityVariant["kind"],
  mode: ClipperLayoutMode,
  viewports: NormalizedBox[],
  envelopes: ImportanceRegion[],
): VisibilityVariant {
  return { kind, mode, viewports, requiredCoverage: coverage(viewports, envelopes) };
}

/**
 * Run 9's least-invasive rescue ladder. It is deterministic, clip-agnostic,
 * never reads ground truth, and never carries lookahead or panel identity over a cut.
 */
export function planVisibilityRescue(input: {
  samples: ImportanceRegionSample[];
  importanceIndex: number;
  baselineViewport: NormalizedBox;
  sourceAspect: number;
  targetAspect: number;
  state: VisibilityControllerState;
  params?: VisibilityControllerParams;
}): VisibilityControllerDecision {
  const params = input.params ?? RUN9_VISIBILITY_CONTROLLER_PARAMS;
  const sample = input.samples[input.importanceIndex] ?? { time: 0, regions: [] };
  const time = sample.time;
  if (sample.cut) {
    input.state.scene++;
    input.state.activeMode = "single-crop";
    input.state.modeSince = time;
    input.state.riskClearedAt = null;
    input.state.lastRiskAt = null;
    input.state.panelOrder = [];
    input.state.previousViewport = null;
    input.state.machineState = "common";
    input.state.pendingSince = null;
    input.state.lastSplitViewports = [];
    input.state.identityLostAt = null;
    input.state.modeSwitchTimestamps = [];
    input.state.sceneStartedAt = time;
  }
  const lookaheadEnvelopes = buildVisibilityEnvelopes(input.samples, input.importanceIndex, params);
  // Hard coverage is evaluated for the current motion-padded subjects. The
  // farther lookahead boxes steer the camera; demanding the whole trajectory
  // fit at once would turn ordinary pans into unnecessary contain windows.
  const envelopes = buildVisibilityEnvelopes(input.samples, input.importanceIndex, {
    ...params,
    lookaheadSec: 0,
  });
  const baseline = variant("run8-baseline", "single-crop", [input.baselineViewport], envelopes);
  const variants: VisibilityVariant[] = [baseline];
  if (!params.enabled || !envelopes.length || sample.cut
    || envelopes.some((region) => region.predicted || region.identityAmbiguous)) {
    return {
      mode: "single-crop",
      viewports: [input.baselineViewport],
      envelopes,
      variants,
      baselineCoverage: baseline.requiredCoverage,
      selectedCoverage: baseline.requiredCoverage,
      reasonCodes: [sample.cut ? "run9-shot-boundary" : "run8-fallback"],
      visibilityRisk: false,
    };
  }

  const requiredUnion = union(envelopes.map((region) => region.contentBox))!;
  const lookaheadUnion = union(lookaheadEnvelopes.map((region) => region.contentBox)) ?? requiredUnion;
  const baselineCenter = {
    x: input.baselineViewport.x + input.baselineViewport.width / 2,
    y: input.baselineViewport.y + input.baselineViewport.height / 2,
  };
  const lookaheadCenter = {
    x: lookaheadUnion.x + lookaheadUnion.width / 2,
    y: lookaheadUnion.y + lookaheadUnion.height * 0.44,
  };
  const shifted = fitViewport(
    requiredUnion,
    input.baselineViewport.width,
    input.baselineViewport.height,
    lookaheadCenter,
  );
  if (shifted) variants.push(variant("shifted-crop", "single-crop", [shifted], envelopes));

  const nominal = nominalCropSize(input.sourceAspect, input.targetAspect);
  const currentScale = Math.max(
    input.baselineViewport.width / Math.max(EPSILON, nominal.width),
    input.baselineViewport.height / Math.max(EPSILON, nominal.height),
  );
  const wider = cropForEnvelope(requiredUnion, input.sourceAspect, input.targetAspect, Math.min(1, currentScale + 0.08));
  if (wider) variants.push(variant("wider-crop", "single-crop", [wider], envelopes));

  const requiredIds = envelopes.map((region) => region.id);
  const pairStable = envelopes.length === 2
    && envelopes.every(hasIndependentEvidence)
    && envelopes.every((region) => (region.associationConfidence ?? 1) >= (params.minimumAssociationConfidence ?? 0))
    && stablePair(input.samples, input.importanceIndex, requiredIds, params.splitStableSamples);
  if (pairStable) {
    const ordered = orderedPair(envelopes, input.state);
    const panelAspect = input.targetAspect * 2;
    const panels = ordered.map((region) => cropForEnvelope(region.contentBox, input.sourceAspect, panelAspect, 0.55));
    if (panels.every((panel): panel is NormalizedBox => panel != null)) {
      variants.push(variant(params.splitVariant === "v3" ? "stable-split-v3" : "stable-split-v2", "split", panels, envelopes));
    }
  }
  const ambiguousGroup = similarlyImportantPeople(sample) >= 3;
  variants.push(variant("contain-fail-safe", "contain", [{ x: 0, y: 0, width: 1, height: 1 }], envelopes));

  const predictedEdgeRisk = edgeRisk(input.samples, input.importanceIndex, lookaheadEnvelopes, params.edgeRiskFraction);
  const lookaheadCoverage = coverage([input.baselineViewport], lookaheadEnvelopes);
  const baselineSafe = coversAll(baseline.requiredCoverage)
    && coversAll(lookaheadCoverage)
    && !predictedEdgeRisk;
  if (baselineSafe && input.state.activeMode === "single-crop") {
    input.state.previousViewport = input.baselineViewport;
    return {
      mode: "single-crop",
      viewports: [input.baselineViewport],
      envelopes,
      variants,
      baselineCoverage: baseline.requiredCoverage,
      selectedCoverage: baseline.requiredCoverage,
      reasonCodes: ["run8-safe-margin"],
      visibilityRisk: false,
    };
  }

  const safeCommonCrop = variants.find((candidate) =>
    (candidate.kind === "shifted-crop" || candidate.kind === "wider-crop") && coversAll(candidate.requiredCoverage));
  let selected = safeCommonCrop;
  if (!selected && !ambiguousGroup) {
    selected = variants.find((candidate) => (candidate.kind === "stable-split-v2" || candidate.kind === "stable-split-v3") && coversAll(candidate.requiredCoverage));
  }
  if (!selected) selected = variants.find((candidate) => candidate.kind === "contain-fail-safe")!;

  const currentMode = input.state.activeMode;
  const activeFor = time - input.state.modeSince;
  const splitCandidate = variants.find((candidate) => candidate.kind === "stable-split-v2" || candidate.kind === "stable-split-v3");
  const splitPendingSec = params.splitPendingSec ?? 0;
  if (selected.mode === "split" && currentMode !== "split") {
    if (input.state.machineState !== "split-pending") {
      input.state.machineState = "split-pending";
      input.state.pendingSince = time;
    }
    if (time - (input.state.pendingSince ?? time) < splitPendingSec || !pairStable) {
      selected = safeCommonCrop ?? baseline;
    }
  } else if (selected.mode !== "split" && currentMode !== "split") {
    input.state.pendingSince = null;
    input.state.machineState = selected.mode === "contain" ? "contain-failsafe" : "common";
  }
  if (currentMode === "split" && activeFor < params.splitMinDurationSec) {
    selected = splitCandidate ?? (time - (input.state.identityLostAt ?? time) <= (params.identityHoldSec ?? 0.6)
      && input.state.lastSplitViewports.length === 2
      ? variant(params.splitVariant === "v3" ? "stable-split-v3" : "stable-split-v2", "split", input.state.lastSplitViewports, envelopes)
      : selected);
  } else if (currentMode === "split" && baselineSafe) {
    input.state.riskClearedAt ??= time;
    if (time - input.state.riskClearedAt < params.splitExitStableSec) {
      input.state.machineState = "merge-pending";
      selected = splitCandidate ?? selected;
    }
  } else if (currentMode === "contain" && activeFor < params.containMinDurationSec) {
    selected = variants.find((candidate) => candidate.kind === "contain-fail-safe")!;
  } else if (baselineSafe && input.state.lastRiskAt != null && time - input.state.lastRiskAt < params.widerHoldSec) {
    selected = variants.find((candidate) => candidate.kind === "wider-crop") ?? selected;
  }
  if (selected.mode === "contain" && currentMode === "contain" && activeFor >= params.containMaxDurationSec && !ambiguousGroup) {
    selected = safeCommonCrop ?? baseline;
  }

  if (currentMode === "split" && !splitCandidate) {
    input.state.identityLostAt ??= time;
    if (time - input.state.identityLostAt <= (params.identityHoldSec ?? 0.6) && input.state.lastSplitViewports.length === 2) {
      selected = variant(params.splitVariant === "v3" ? "stable-split-v3" : "stable-split-v2", "split", input.state.lastSplitViewports, envelopes);
    }
  } else if (splitCandidate) input.state.identityLostAt = null;

  if (selected.mode !== currentMode) {
    input.state.modeSwitchTimestamps = input.state.modeSwitchTimestamps.filter((timestamp) => time - timestamp < 60);
    const rate = params.maxSwitchesPerMinute ?? Number.POSITIVE_INFINITY;
    const budget = Number.isFinite(rate)
      ? Math.floor(Math.max(0, time - input.state.sceneStartedAt) * rate / 60 + EPSILON)
      : Number.POSITIVE_INFINITY;
    const currentVariant = variants.find((candidate) => candidate.mode === currentMode);
    const minimum = (values: number[]) => values.length ? Math.min(...values) : 0;
    const coverageImproves = minimum(selected.requiredCoverage) > minimum(currentVariant?.requiredCoverage ?? baseline.requiredCoverage) + EPSILON;
    const mustExitExpiredContain = currentMode === "contain" && activeFor >= params.containMaxDurationSec;
    if (input.state.modeSwitchTimestamps.length >= budget && !coverageImproves && !mustExitExpiredContain) {
      selected = currentVariant ?? baseline;
    }
  }

  const risk = !baselineSafe;
  if (risk) {
    input.state.lastRiskAt = time;
    input.state.riskClearedAt = null;
  } else {
    input.state.riskClearedAt ??= time;
  }
  if (selected.mode !== input.state.activeMode) {
    input.state.modeSwitchTimestamps.push(time);
    input.state.activeMode = selected.mode;
    input.state.modeSince = time;
  }
  if (!(input.state.machineState === "split-pending" && selected.mode !== "split")) {
    input.state.machineState = selected.mode === "split"
      ? "split-active"
      : selected.mode === "contain"
        ? "contain-failsafe"
        : "common";
  }
  if (selected.mode === "split") input.state.lastSplitViewports = selected.viewports.map((viewport) => ({ ...viewport }));
  input.state.previousViewport = selected.viewports[0] ?? input.baselineViewport;
  const reason = selected.kind === "shifted-crop"
    ? "visibility-shift"
    : selected.kind === "wider-crop"
      ? "visibility-widen"
      : selected.kind === "stable-split-v2" || selected.kind === "stable-split-v3"
        ? selected.kind
        : selected.kind === "contain-fail-safe"
          ? ambiguousGroup ? "contain-ambiguous-group" : "contain-visibility-fail-safe"
          : "run8-safe-margin";
  return {
    mode: selected.mode,
    viewports: selected.viewports,
    envelopes,
    variants,
    baselineCoverage: baseline.requiredCoverage,
    selectedCoverage: selected.requiredCoverage,
    reasonCodes: [reason, ...(predictedEdgeRisk ? ["outward-edge-risk"] : []), "lookahead-envelope"],
    visibilityRisk: risk,
  };
}
