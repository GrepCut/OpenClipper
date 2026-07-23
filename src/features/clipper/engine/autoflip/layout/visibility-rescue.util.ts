import type {
  ImportanceRegion,
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
  orderedTriple,
  stablePair,
  stableTriple,
  variant,
  VISIBILITY_EPSILON,
} from "./visibility-rescue-helpers.util";

const EPSILON = VISIBILITY_EPSILON;
const EMERGENCY_PRIMARY_COVERAGE = 0.8;
const SINGLE_TARGET_HOLD_SEC = 0.6;
const SINGLE_CAMERA_DEAD_ZONE = 0.03;
const SINGLE_CAMERA_MAX_SPEED_PER_SEC = 0.16;
const SINGLE_CAMERA_MAX_ACCELERATION_PER_SEC2 = 0.4;

function splitThreePanelAspects(targetAspect: number): [number, number, number] {
  // Portrait: primary full-width above two half-width panels. Square and
  // landscape: primary on the left, two secondary panels stacked on the right.
  return targetAspect < 1
    ? [targetAspect * 2, targetAspect, targetAspect]
    : [targetAspect * 0.6, targetAspect * 0.8, targetAspect * 0.8];
}

function currentVariant(state: VisibilityControllerState, envelopes: ImportanceRegion[]): VisibilityVariant | null {
  if (state.activeMode !== "split" || !state.lastSplitViewports.length) return null;
  const kind = state.lastSplitViewports.length === 3
    ? "stable-split-3"
    : "stable-split-v3";
  return variant(kind, "split", state.lastSplitViewports, envelopes);
}

function layoutKey(mode: string, viewportCount: number): string {
  return `${mode}:${viewportCount}`;
}

function resetSingleTargetState(state: VisibilityControllerState): void {
  state.singlePrimaryId = null;
  state.pendingSinglePrimaryId = null;
  state.pendingSinglePrimarySince = null;
  state.singleViewport = null;
  state.singleVelocity = { x: 0, y: 0 };
  state.singleLastUpdatedAt = null;
}

function viewportCenter(viewport: NormalizedBox): { x: number; y: number } {
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

function stabilizeSinglePrimaryViewport(
  state: VisibilityControllerState,
  primaryId: string,
  candidate: NormalizedBox,
  baseline: NormalizedBox,
  time: number,
  emergency: boolean,
): NormalizedBox | null {
  if (emergency) {
    state.singlePrimaryId = primaryId;
    state.pendingSinglePrimaryId = null;
    state.pendingSinglePrimarySince = null;
    state.singleViewport = candidate;
    state.singleVelocity = { x: 0, y: 0 };
    state.singleLastUpdatedAt = time;
    return candidate;
  }

  if (state.singlePrimaryId !== primaryId) {
    if (state.pendingSinglePrimaryId !== primaryId) {
      state.pendingSinglePrimaryId = primaryId;
      state.pendingSinglePrimarySince = time;
    }
    if (time - (state.pendingSinglePrimarySince ?? time) < SINGLE_TARGET_HOLD_SEC) {
      state.singleVelocity = { x: 0, y: 0 };
      state.singleLastUpdatedAt = time;
      return state.singleViewport;
    }
    state.singlePrimaryId = primaryId;
    state.pendingSinglePrimaryId = null;
    state.pendingSinglePrimarySince = null;
    state.singleViewport ??= baseline;
    state.singleVelocity = { x: 0, y: 0 };
  }

  const current = state.singleViewport ?? baseline;
  const previousCenter = viewportCenter(current);
  const candidateCenter = viewportCenter(candidate);
  const dx = candidateCenter.x - previousCenter.x;
  const dy = candidateCenter.y - previousCenter.y;
  const distance = Math.hypot(dx, dy);
  const elapsed = Math.max(0, time - (state.singleLastUpdatedAt ?? time));
  if (distance <= SINGLE_CAMERA_DEAD_ZONE || elapsed <= 0) {
    state.singleViewport = current;
    state.singleVelocity = { x: 0, y: 0 };
    state.singleLastUpdatedAt = time;
    return current;
  }

  const desiredVelocity = { x: dx / elapsed, y: dy / elapsed };
  const maxVelocityDelta = SINGLE_CAMERA_MAX_ACCELERATION_PER_SEC2 * elapsed;
  const velocity = {
    x: Math.max(-SINGLE_CAMERA_MAX_SPEED_PER_SEC, Math.min(SINGLE_CAMERA_MAX_SPEED_PER_SEC,
      Math.max(state.singleVelocity.x - maxVelocityDelta, Math.min(state.singleVelocity.x + maxVelocityDelta, desiredVelocity.x)))),
    y: Math.max(-SINGLE_CAMERA_MAX_SPEED_PER_SEC, Math.min(SINGLE_CAMERA_MAX_SPEED_PER_SEC,
      Math.max(state.singleVelocity.y - maxVelocityDelta, Math.min(state.singleVelocity.y + maxVelocityDelta, desiredVelocity.y)))),
  };
  const width = candidate.width;
  const height = candidate.height;
  const viewport = {
    ...candidate,
    x: Math.max(0, Math.min(1 - width, previousCenter.x + velocity.x * elapsed - width / 2)),
    y: Math.max(0, Math.min(1 - height, previousCenter.y + velocity.y * elapsed - height / 2)),
  };
  state.singleViewport = viewport;
  state.singleVelocity = velocity;
  state.singleLastUpdatedAt = time;
  return viewport;
}

/**
 * A strict-cover rescue ladder. It never falls back to contain/padding:
 * shift → aspect-preserving widen → stable split 2/3 → primary crop.
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
    input.state.activeViewportCount = 1;
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
    resetSingleTargetState(input.state);
  }

  const lookaheadEnvelopes = buildVisibilityEnvelopes(input.samples, input.importanceIndex, params);
  const envelopes = buildVisibilityEnvelopes(input.samples, input.importanceIndex, { ...params, lookaheadSec: 0 });
  const baseline = variant("run8-baseline", "single-crop", [input.baselineViewport], envelopes);
  const variants: VisibilityVariant[] = [baseline];
  const emergency = (baseline.requiredCoverage[0] ?? 1) < EMERGENCY_PRIMARY_COVERAGE;
  const singlePrimary = envelopes.length === 1
    && envelopes[0]?.role === "primary"
    && hasIndependentEvidence(envelopes[0]);
  if (!singlePrimary) resetSingleTargetState(input.state);
  if (!params.enabled || !envelopes.length || (sample.cut && !singlePrimary)
    || envelopes.some((region) => region.predicted || region.identityAmbiguous)) {
    return {
      mode: "single-crop",
      viewports: [input.baselineViewport],
      envelopes,
      variants,
      baselineCoverage: baseline.requiredCoverage,
      selectedCoverage: baseline.requiredCoverage,
      reasonCodes: [sample.cut ? "shot-boundary" : "stable-single-fallback"],
      visibilityRisk: false,
    };
  }

  const requiredUnion = union(envelopes.map((region) => region.contentBox))!;
  const lookaheadUnion = union(lookaheadEnvelopes.map((region) => region.contentBox)) ?? requiredUnion;
  // A safe AutoFlip crop only guarantees that the person remains visible; it
  // can still leave them at one side of the frame. For a single confirmed
  // primary, compose against the current subject horizontally. Keep the
  // vertical look-ahead bias so headroom and vertical motion remain stable.
  const centeredSingleCandidate = singlePrimary
    ? fitViewport(requiredUnion, input.baselineViewport.width, input.baselineViewport.height, {
      x: requiredUnion.x + requiredUnion.width / 2,
      y: lookaheadUnion.y + lookaheadUnion.height * 0.44,
    })
    : null;
  const stabilizedSingleViewport = centeredSingleCandidate && envelopes[0]
    ? stabilizeSinglePrimaryViewport(
      input.state,
      envelopes[0].id,
      centeredSingleCandidate,
      input.baselineViewport,
      time,
      emergency,
    )
    : null;
  const centeredSingle = stabilizedSingleViewport
    ? variant("shifted-crop", "single-crop", [stabilizedSingleViewport], envelopes)
    : null;
  if (centeredSingle) variants.push(centeredSingle);
  const shifted = fitViewport(requiredUnion, input.baselineViewport.width, input.baselineViewport.height, {
    x: lookaheadUnion.x + lookaheadUnion.width / 2,
    y: lookaheadUnion.y + lookaheadUnion.height * 0.44,
  });
  if (shifted) variants.push(variant("shifted-crop", "single-crop", [shifted], envelopes));

  const nominal = nominalCropSize(input.sourceAspect, input.targetAspect);
  const currentScale = Math.max(
    input.baselineViewport.width / Math.max(EPSILON, nominal.width),
    input.baselineViewport.height / Math.max(EPSILON, nominal.height),
  );
  const wider = cropForEnvelope(requiredUnion, input.sourceAspect, input.targetAspect, Math.min(1, currentScale + 0.08));
  if (wider) variants.push(variant("wider-crop", "single-crop", [wider], envelopes));

  const stableEvidence = envelopes.every(hasIndependentEvidence)
    && envelopes.every((region) => (region.associationConfidence ?? 1) >= (params.minimumAssociationConfidence ?? 0));
  const ids = envelopes.map((region) => region.id);
  const pairStable = envelopes.length === 2 && stableEvidence
    && stablePair(input.samples, input.importanceIndex, ids, params.splitStableSamples);
  const tripleStable = envelopes.length === 3 && stableEvidence
    && stableTriple(input.samples, input.importanceIndex, ids, params.splitStableSamples);
  if (pairStable) {
    const panels = orderedPair(envelopes, input.state)
      .map((region) => cropForEnvelope(region.contentBox, input.sourceAspect, input.targetAspect * 2, 0.55));
    if (panels.every((panel): panel is NormalizedBox => panel != null)) {
      variants.push(variant(params.splitVariant === "v3" ? "stable-split-v3" : "stable-split-v2", "split", panels, envelopes));
    }
  }
  if (tripleStable) {
    const aspects = splitThreePanelAspects(input.targetAspect);
    const panels = orderedTriple(envelopes, input.state)
      .map((region, index) => cropForEnvelope(region.contentBox, input.sourceAspect, aspects[index]!, 0.55));
    if (panels.every((panel): panel is NormalizedBox => panel != null)) {
      variants.push(variant("stable-split-3", "split", panels, envelopes));
    }
  }

  const predictedEdgeRisk = edgeRisk(input.samples, input.importanceIndex, lookaheadEnvelopes, params.edgeRiskFraction);
  const lookaheadCoverage = coverage([input.baselineViewport], lookaheadEnvelopes);
  const baselineSafe = coversAll(baseline.requiredCoverage) && coversAll(lookaheadCoverage) && !predictedEdgeRisk;
  // A single confirmed primary is handled by the stateful controller above.
  // Letting this raw rescue candidate win would bypass its target hold and
  // recreate the detector-driven pan every 0.2 seconds.
  const safeCommonCrop = singlePrimary
    ? undefined
    : variants.find((candidate) =>
      (candidate.kind === "shifted-crop" || candidate.kind === "wider-crop") && coversAll(candidate.requiredCoverage));
  const splitCandidate = variants.find((candidate) =>
    (candidate.kind === "stable-split-v2" || candidate.kind === "stable-split-v3" || candidate.kind === "stable-split-3")
      && coversAll(candidate.requiredCoverage));
  const primaryCenterSafe = centeredSingle != null && (
    coversAll(centeredSingle.requiredCoverage)
    || input.state.singlePrimaryId === envelopes[0]?.id
  );
  let selected = primaryCenterSafe ? centeredSingle : baselineSafe ? baseline : safeCommonCrop ?? splitCandidate ?? baseline;

  const currentKey = layoutKey(input.state.activeMode, input.state.activeViewportCount);
  const selectedKey = layoutKey(selected.mode, selected.viewports.length);
  const activeFor = time - input.state.modeSince;
  const switching = currentKey !== selectedKey;
  if (switching && selected.mode === "split" && !emergency) {
    if (input.state.machineState !== "split-pending") {
      input.state.machineState = "split-pending";
      input.state.pendingSince = time;
    }
    if (time - (input.state.pendingSince ?? time) < (params.splitPendingSec ?? 1.5)) {
      selected = safeCommonCrop ?? baseline;
    }
  } else if (selected.mode !== "split") {
    input.state.pendingSince = null;
  }

  const selectedAfterPendingKey = layoutKey(selected.mode, selected.viewports.length);
  const activeSplit = currentVariant(input.state, envelopes);
  if (!emergency && currentKey !== selectedAfterPendingKey && activeFor < params.splitMinDurationSec && activeSplit) {
    selected = activeSplit;
  } else if (!emergency && input.state.activeMode === "split" && baselineSafe) {
    input.state.riskClearedAt ??= time;
    if (time - input.state.riskClearedAt < params.splitExitStableSec && activeSplit) {
      input.state.machineState = "merge-pending";
      selected = activeSplit;
    }
  }

  const finalKey = layoutKey(selected.mode, selected.viewports.length);
  if (finalKey !== currentKey) {
    input.state.modeSwitchTimestamps = input.state.modeSwitchTimestamps.filter((timestamp) => time - timestamp < 60);
    const rate = params.maxSwitchesPerMinute ?? Number.POSITIVE_INFINITY;
    const coverageImproves = minimumCoverage(selected.requiredCoverage)
      > minimumCoverage(activeSplit?.requiredCoverage ?? baseline.requiredCoverage) + EPSILON;
    if (!emergency && input.state.modeSwitchTimestamps.length >= rate && !coverageImproves) {
      selected = activeSplit ?? baseline;
    }
  }

  const risk = !baselineSafe;
  if (risk) {
    input.state.lastRiskAt = time;
    input.state.riskClearedAt = null;
  } else {
    input.state.riskClearedAt ??= time;
  }
  const committedKey = layoutKey(selected.mode, selected.viewports.length);
  if (committedKey !== currentKey) {
    input.state.modeSwitchTimestamps.push(time);
    input.state.activeMode = selected.mode;
    input.state.activeViewportCount = selected.viewports.length;
    input.state.modeSince = time;
  }
  if (!(input.state.machineState === "split-pending" && selected.mode !== "split")) {
    input.state.machineState = selected.mode === "split" ? "split-active" : "common";
  }
  if (selected.mode === "split") input.state.lastSplitViewports = selected.viewports.map((viewport) => ({ ...viewport }));
  input.state.previousViewport = selected.viewports[0] ?? input.baselineViewport;
  const reason = selected === centeredSingle
    ? "primary-horizontal-center"
    : selected.kind === "shifted-crop"
    ? "visibility-shift"
    : selected.kind === "wider-crop"
      ? "visibility-widen"
      : selected.kind === "stable-split-3"
        ? "stable-split-3"
        : selected.kind === "stable-split-v2" || selected.kind === "stable-split-v3"
          ? selected.kind
          : "stable-primary-crop";
  return {
    mode: selected.mode,
    viewports: selected.viewports,
    envelopes,
    variants,
    baselineCoverage: baseline.requiredCoverage,
    selectedCoverage: selected.requiredCoverage,
    reasonCodes: [reason, ...(emergency ? ["primary-coverage-emergency"] : []), ...(predictedEdgeRisk ? ["outward-edge-risk"] : []), "lookahead-envelope"],
    visibilityRisk: risk,
  };
}
