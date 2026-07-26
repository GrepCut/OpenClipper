import type {
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../../shared/smart-crop.util";
import { fitSeparatedSplitPanels, framingCenterYFraction, nominalCropSize, splitPanelsPreserveSubjects, splitViewportsAreDistinct } from "./viewport-geometry.util";
import type {
  VisibilityControllerDecision,
  VisibilityControllerParams,
  VisibilityControllerState,
  VisibilityVariant,
} from "../../types/autoflip-layout.types";
import { LEGACY_VISIBILITY_PARAMS } from "./visibility-controller.constants";
import { buildEmergencyPrimaryCrop, primaryCoverageOf } from "./emergency-primary-crop.util";
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
/** Faster than normal, still blocks layout teleports (~2.5/s). */
const EMERGENCY_CAMERA_MAX_SPEED_PER_SEC = 0.40;
const EMERGENCY_CAMERA_MAX_ACCELERATION_PER_SEC2 = 1.0;
const REVERSE_BRAKE_MULT = 2;
/** Nominal layout sample period — used when seeding a same-frame ease step. */
const LAYOUT_SAMPLE_DT_SEC = 0.2;

function signNonZero(value: number): number {
  if (value > EPSILON) return 1;
  if (value < -EPSILON) return -1;
  return 0;
}

function clampAxisVelocity(
  previous: number,
  desired: number,
  maxSpeed: number,
  maxAccelDelta: number,
): number {
  const reversing = signNonZero(previous) !== 0
    && signNonZero(desired) !== 0
    && signNonZero(previous) !== signNonZero(desired);
  const budget = reversing ? maxAccelDelta * REVERSE_BRAKE_MULT : maxAccelDelta;
  return Math.max(-maxSpeed, Math.min(maxSpeed,
    Math.max(previous - budget, Math.min(previous + budget, desired))));
}

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
  return variant(kind, "split", state.lastSplitViewports, envelopes, state.lastSplitPanelSubjects.map((subject) => ({
    id: subject.id,
    box: subject.focusBox,
  })) as ImportanceRegion[]);
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
  // Emergency no longer teleports — same kinematic path with higher caps.
  if (state.singlePrimaryId !== primaryId) {
    if (!emergency) {
      if (state.pendingSinglePrimaryId !== primaryId) {
        state.pendingSinglePrimaryId = primaryId;
        state.pendingSinglePrimarySince = time;
      }
      if (time - (state.pendingSinglePrimarySince ?? time) < SINGLE_TARGET_HOLD_SEC) {
        state.singleVelocity = { x: 0, y: 0 };
        state.singleLastUpdatedAt = time;
        return state.singleViewport;
      }
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

  const maxSpeed = emergency ? EMERGENCY_CAMERA_MAX_SPEED_PER_SEC : SINGLE_CAMERA_MAX_SPEED_PER_SEC;
  const maxAccel = emergency
    ? EMERGENCY_CAMERA_MAX_ACCELERATION_PER_SEC2
    : SINGLE_CAMERA_MAX_ACCELERATION_PER_SEC2;
  const desiredVelocity = { x: dx / elapsed, y: dy / elapsed };
  const maxVelocityDelta = maxAccel * elapsed;
  const velocity = {
    x: clampAxisVelocity(state.singleVelocity.x, desiredVelocity.x, maxSpeed, maxVelocityDelta),
    y: clampAxisVelocity(state.singleVelocity.y, desiredVelocity.y, maxSpeed, maxVelocityDelta),
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

function seedSingleFromSplitPanel(state: VisibilityControllerState, time: number): void {
  const panel = state.lastSplitViewports[0];
  if (!panel) return;
  state.singleViewport = { ...panel };
  state.singleVelocity = { x: 0, y: 0 };
  // Allow one integration step toward the new single target this sample.
  state.singleLastUpdatedAt = time - LAYOUT_SAMPLE_DT_SEC;
}

function easeFinalSingleCrop(input: {
  state: VisibilityControllerState;
  selected: VisibilityVariant;
  centeredSingle: VisibilityVariant | null;
  primaryId: string;
  baseline: NormalizedBox;
  envelopes: ImportanceRegion[];
  time: number;
  emergency: boolean;
  splitSeed: boolean;
}): VisibilityVariant {
  const { state, selected, centeredSingle, primaryId, baseline, envelopes, time, emergency } = input;
  if (selected.mode !== "single-crop" || !selected.viewports[0]) return selected;

  if (input.splitSeed) seedSingleFromSplitPanel(state, time);

  // Already eased this sample via centeredSingle — keep unless we seeded from split
  // or the selection jumped to a different single target (emergency / baseline).
  if (selected === centeredSingle && !input.splitSeed) return selected;

  // Same-frame re-ease toward a new target: rewind the clock one sample.
  if (state.singleLastUpdatedAt != null && state.singleLastUpdatedAt >= time - 1e-9) {
    state.singleLastUpdatedAt = time - LAYOUT_SAMPLE_DT_SEC;
  }

  const eased = stabilizeSinglePrimaryViewport(
    state,
    primaryId,
    selected.viewports[0],
    baseline,
    time,
    emergency || selected.kind === "emergency-primary-crop",
  );
  if (!eased) return selected;
  return variant(selected.kind, "single-crop", [eased], envelopes);
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
  const activeSplitBeforeEvidence = currentVariant(input.state, envelopes);
  const emergency = (baseline.requiredCoverage[0] ?? 1) < EMERGENCY_PRIMARY_COVERAGE;
  const trackedPrediction = envelopes.length === 1
    && envelopes[0]?.role === "primary"
    && envelopes[0].predicted === true
    && (envelopes[0].trust === "temporally-qualified-person" || envelopes[0].trust === "object");
  const singlePrimary = envelopes.length === 1
    && envelopes[0]?.role === "primary"
    && (hasIndependentEvidence(envelopes[0]) || trackedPrediction);
  if (!singlePrimary) resetSingleTargetState(input.state);
  if (!params.enabled || !envelopes.length || (sample.cut && !singlePrimary)
    || envelopes.some((region) => region.identityAmbiguous)
    || (envelopes.some((region) => region.predicted) && !trackedPrediction)) {
    // A detector dropout is not evidence that the editorial split ended.
    // Keep the previously confirmed layout until the same exit confirmation
    // window used by the state machine has elapsed.
    if (!sample.cut && activeSplitBeforeEvidence) {
      input.state.identityLostAt ??= time;
      if (time - input.state.identityLostAt < params.splitExitStableSec) {
        return {
          mode: "split",
          viewports: activeSplitBeforeEvidence.viewports,
          envelopes,
          variants: [...variants, activeSplitBeforeEvidence],
          baselineCoverage: baseline.requiredCoverage,
          selectedCoverage: activeSplitBeforeEvidence.requiredCoverage,
          reasonCodes: ["stable-split-dropout-hold"],
          visibilityRisk: true,
        };
      }
    }
    if (input.state.activeMode === "split") {
      input.state.activeMode = "single-crop";
      input.state.activeViewportCount = 1;
      input.state.modeSince = time;
      input.state.lastSplitViewports = [];
      input.state.identityLostAt = null;
    }
    const noTargetReason = sample.targetEvidence?.status === "temporal-pending"
      ? "temporal-person-pending"
      : "no-target-evidence";
    return {
      mode: "single-crop",
      viewports: [input.baselineViewport],
      envelopes,
      variants,
      baselineCoverage: baseline.requiredCoverage,
      selectedCoverage: baseline.requiredCoverage,
      reasonCodes: [sample.cut ? "shot-boundary" : !envelopes.length ? noTargetReason : "stable-single-fallback"],
      visibilityRisk: false,
    };
  }

  const requiredUnion = union(envelopes.map((region) => region.contentBox))!;
  const lookaheadUnion = union(lookaheadEnvelopes.map((region) => region.contentBox)) ?? requiredUnion;
  // A safe AutoFlip crop only guarantees that the person remains visible; it
  // can still leave them at one side of the frame. For a single confirmed
  // primary, compose against the current subject horizontally. Vertical
  // headroom applies only when the crop can show real content above.
  const lookAheadCenterY = lookaheadUnion.y
    + lookaheadUnion.height * framingCenterYFraction(lookaheadUnion, input.baselineViewport.height);
  const centeredSingleCandidate = singlePrimary
    ? fitViewport(requiredUnion, input.baselineViewport.width, input.baselineViewport.height, {
      x: requiredUnion.x + requiredUnion.width / 2,
      y: lookAheadCenterY,
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
    y: lookAheadCenterY,
  });
  if (shifted) variants.push(variant("shifted-crop", "single-crop", [shifted], envelopes));

  const nominal = nominalCropSize(input.sourceAspect, input.targetAspect);
  const currentScale = Math.max(
    input.baselineViewport.width / Math.max(EPSILON, nominal.width),
    input.baselineViewport.height / Math.max(EPSILON, nominal.height),
  );
  const wider = cropForEnvelope(requiredUnion, input.sourceAspect, input.targetAspect, Math.min(1, currentScale + 0.08));
  if (wider) variants.push(variant("wider-crop", "single-crop", [wider], envelopes));

  // When the required union cannot share one crop (or baseline already misses
  // the star), frame the primary box alone instead of keeping a bad baseline.
  const primaryRegion = envelopes.find((region) => region.role === "primary") ?? envelopes[0]!;
  const emergencyPrimary = (emergency || !shifted)
    ? buildEmergencyPrimaryCrop(primaryRegion, input.baselineViewport, envelopes)
    : null;
  if (emergencyPrimary) variants.push(emergencyPrimary);

  // Split screen is not permitted for landscape/wide formats (targetAspect > 1.0).
  const allowSplitForAspect = input.targetAspect <= 1.0;
  const stableEvidence = envelopes.every(hasIndependentEvidence)
    && envelopes.every((region) => (region.associationConfidence ?? 1) >= (params.minimumAssociationConfidence ?? 0));
  const pairStable = allowSplitForAspect && envelopes.length === 2 && stableEvidence
    && stablePair(input.samples, input.importanceIndex, envelopes, params.splitStableSamples);
  const ids = envelopes.map((region) => region.id);
  const tripleStable = allowSplitForAspect && envelopes.length === 3 && stableEvidence
    && stableTriple(input.samples, input.importanceIndex, ids, params.splitStableSamples);
  if (pairStable) {
    const panelRegions = orderedPair(envelopes, input.state);
    const targetAspects = [input.targetAspect * 2, input.targetAspect * 2];
    const panels = fitSeparatedSplitPanels(
      panelRegions.map((r) => ({ id: r.id, box: r.box, contentBox: r.contentBox })),
      input.sourceAspect,
      targetAspects,
    );
    if (panels) {
      variants.push(variant(params.splitVariant === "v3" ? "stable-split-v3" : "stable-split-v2", "split", panels, envelopes, panelRegions));
    }
  }
  if (tripleStable) {
    const aspects = splitThreePanelAspects(input.targetAspect);
    const panelRegions = orderedTriple(envelopes, input.state);
    const panels = fitSeparatedSplitPanels(
      panelRegions.map((r) => ({ id: r.id, box: r.box, contentBox: r.contentBox })),
      input.sourceAspect,
      aspects,
    );
    if (panels) {
      variants.push(variant("stable-split-3", "split", panels, envelopes, panelRegions));
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
  // For square 1:1 formats (input.targetAspect === 1.0), prioritize single-crop
  // (shifted/wider/baseline crop) over split screen whenever a single crop is safe.
  const preferSingleForSquare = Math.abs(input.targetAspect - 1.0) < EPSILON;
  let selected = primaryCenterSafe
    ? centeredSingle
    : baselineSafe
    ? baseline
    : preferSingleForSquare
      ? (safeCommonCrop ?? splitCandidate ?? emergencyPrimary ?? baseline)
      : (safeCommonCrop ?? splitCandidate ?? emergencyPrimary ?? baseline);
  if (preferSingleForSquare && (safeCommonCrop || baselineSafe)) {
    selected = primaryCenterSafe ? centeredSingle : baselineSafe ? baseline : safeCommonCrop ?? baseline;
  }
  // Last resort: never leave the primary mostly out of frame when a tight
  // primary crop is available (music-video star + crowd / wide pair).
  if (
    emergencyPrimary
    && primaryCoverageOf(selected!, envelopes, primaryRegion.id) < EMERGENCY_PRIMARY_COVERAGE
    && primaryCoverageOf(emergencyPrimary, envelopes, primaryRegion.id) >= EMERGENCY_PRIMARY_COVERAGE
  ) {
    selected = emergencyPrimary;
  }

  // A single-person frame can be a transient detector loss.  The split is
  // allowed to end only after the controller's existing exit confirmation;
  // this is deliberately state-based rather than a frame-count heuristic.
  const heldSplit = currentVariant(input.state, envelopes);
  let holdingActiveSplit = false;
  if (input.state.activeMode === "split" && !pairStable) {
    input.state.identityLostAt ??= time;
    if (heldSplit && time - input.state.identityLostAt < params.splitExitStableSec) {
      selected = heldSplit;
      holdingActiveSplit = true;
    }
  }
  const currentKey = layoutKey(input.state.activeMode, input.state.activeViewportCount);
  const selectedKey = layoutKey(selected.mode, selected.viewports.length);
  const activeFor = time - input.state.modeSince;
  const switching = currentKey !== selectedKey;
  const resumesKnownPair = pairStable
    && input.state.identityLostAt != null
    && time - input.state.identityLostAt <= (params.identityHoldSec ?? 0.6);
  if (switching && selected.mode === "split" && !emergency) {
    if (resumesKnownPair) {
      input.state.pendingSince = null;
    } else if (input.state.machineState !== "split-pending") {
      input.state.machineState = "split-pending";
      input.state.pendingSince = time;
    }
    if (!resumesKnownPair && time - (input.state.pendingSince ?? time) < (params.splitPendingSec ?? 1.5)) {
      selected = safeCommonCrop ?? emergencyPrimary ?? baseline;
      if (
        emergencyPrimary
        && primaryCoverageOf(selected, envelopes, primaryRegion.id) < EMERGENCY_PRIMARY_COVERAGE
        && primaryCoverageOf(emergencyPrimary, envelopes, primaryRegion.id) >= EMERGENCY_PRIMARY_COVERAGE
      ) {
        selected = emergencyPrimary;
      }
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
  if (selected.mode === "split") {
    // Holding a previous layout must not restart the exit timer. Only an
    // independently re-observed pair proves that the split is still valid.
    if (pairStable) input.state.identityLostAt = null;
    input.state.lastSplitViewports = selected.viewports.map((viewport) => ({ ...viewport }));
    input.state.lastSplitPanelSubjects = selected.panelSubjects?.map((subject) => ({
      id: subject.id,
      focusBox: { ...subject.focusBox },
    })) ?? [];
  }

  // Capture split→single seed before emergency force clears lastSplitViewports.
  // activeMode may already be single-crop after the commit above — use currentKey.
  let splitSeed = selected.mode === "single-crop"
    && currentKey.startsWith("split:")
    && input.state.lastSplitViewports.length > 0;

  if (
    emergencyPrimary
    && primaryCoverageOf(selected, envelopes, primaryRegion.id) < EMERGENCY_PRIMARY_COVERAGE
    && primaryCoverageOf(emergencyPrimary, envelopes, primaryRegion.id) >= EMERGENCY_PRIMARY_COVERAGE
  ) {
    if (currentKey.startsWith("split:") && input.state.lastSplitViewports[0]) {
      splitSeed = true;
    }
    selected = emergencyPrimary;
    if (currentKey.startsWith("split:") || input.state.activeMode === "split") {
      // Seed from the on-screen primary panel before clearing split state.
      if (splitSeed) seedSingleFromSplitPanel(input.state, time);
      input.state.activeMode = "single-crop";
      input.state.activeViewportCount = 1;
      input.state.modeSince = time;
      input.state.lastSplitViewports = [];
      input.state.machineState = "common";
      splitSeed = false; // already seeded
    }
  }

  selected = easeFinalSingleCrop({
    state: input.state,
    selected,
    centeredSingle,
    primaryId: primaryRegion.id,
    baseline: input.baselineViewport,
    envelopes,
    time,
    emergency,
    splitSeed,
  });
  input.state.previousViewport = selected.viewports[0] ?? input.baselineViewport;

  const reason = selected === centeredSingle
    ? "primary-horizontal-center"
    : selected.kind === "emergency-primary-crop"
    ? "emergency-primary-crop"
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
    reasonCodes: [
      reason,
      ...(holdingActiveSplit ? ["stable-split-dropout-hold"] : []),
      ...(emergency ? ["primary-coverage-emergency"] : []),
      ...(predictedEdgeRisk ? ["outward-edge-risk"] : []),
      "lookahead-envelope",
    ],
    visibilityRisk: risk,
    panelSubjects: selected.panelSubjects,
  };
}
