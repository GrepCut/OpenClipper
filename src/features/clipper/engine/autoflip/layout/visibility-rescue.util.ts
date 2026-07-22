import type {
  ImportanceRegionSample,
  NormalizedBox,
} from "../../../shared/smart-crop.util";
import { nominalCropSize } from "./viewport-geometry.util";
import type {
  VisibilityControllerDecision,
  VisibilityControllerParams,
  VisibilityControllerState,
  VisibilityVariant,
} from "../../types/autoflip-layout.types";
import { LEGACY_VISIBILITY_PARAMS } from "./visibility-controller.constants";
import {
  buildVisibilityEnvelopes,
  coverage,
  coversAll,
  cropForEnvelope,
  fitViewport,
  union,
} from "./visibility-envelope.util";
import {
  edgeRisk,
  hasIndependentEvidence,
  minimumCoverage,
  orderedPair,
  similarlyImportantPeople,
  stablePair,
  variant,
  VISIBILITY_EPSILON,
} from "./visibility-rescue-helpers.util";

const EPSILON = VISIBILITY_EPSILON;

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
  const params = input.params ?? LEGACY_VISIBILITY_PARAMS;
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
    const coverageImproves = minimumCoverage(selected.requiredCoverage) > minimumCoverage(currentVariant?.requiredCoverage ?? baseline.requiredCoverage) + EPSILON;
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
