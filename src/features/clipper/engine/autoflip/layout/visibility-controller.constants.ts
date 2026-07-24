import type { VisibilityControllerParams, VisibilityControllerState } from "../../types/autoflip-layout.types";

export const LEGACY_VISIBILITY_PARAMS: Readonly<VisibilityControllerParams> = Object.freeze({
  enabled: true,
  lookaheadSec: 0.8,
  envelopeMargin: 0.08,
  velocityMarginSec: 0.25,
  edgeRiskFraction: 0.12,
  widerHoldSec: 0.8,
  splitStableSamples: 8,
  splitMinDurationSec: 3,
  splitExitStableSec: 1.5,
});

export const DEFAULT_VISIBILITY_PARAMS: Readonly<VisibilityControllerParams> = Object.freeze({
  ...LEGACY_VISIBILITY_PARAMS,
  splitStableSamples: 8,
  splitPendingSec: 1.5,
  splitMinDurationSec: 3,
  splitExitStableSec: 1.5,
  mergePendingSec: 1.5,
  splitVariant: "v3",
  minimumAssociationConfidence: 0.75,
  maxSwitchesPerMinute: 3,
  riskMergeGapSec: 0.4,
  // A known pair may return over the next two 5 FPS samples without paying
  // the full split-entry debounce again. Longer gaps must be re-confirmed.
  identityHoldSec: 0.5,
  widerHoldSec: 1.2,
});

export const ITERATION10_VISIBILITY_CONTROLLER_PARAMS = DEFAULT_VISIBILITY_PARAMS;

/** @deprecated Use DEFAULT_VISIBILITY_PARAMS */
export const RUN9_VISIBILITY_CONTROLLER_PARAMS = LEGACY_VISIBILITY_PARAMS;

export function createVisibilityControllerState(): VisibilityControllerState {
  return {
    scene: 0,
    activeMode: "single-crop",
    activeViewportCount: 1,
    modeSince: Number.NEGATIVE_INFINITY,
    riskClearedAt: null,
    lastRiskAt: null,
    panelOrder: [],
    previousViewport: null,
    machineState: "common",
    pendingSince: null,
    lastSplitViewports: [],
    lastSplitPanelSubjects: [],
    identityLostAt: null,
    modeSwitchTimestamps: [],
    sceneStartedAt: 0,
    singlePrimaryId: null,
    pendingSinglePrimaryId: null,
    pendingSinglePrimarySince: null,
    singleViewport: null,
    singleVelocity: { x: 0, y: 0 },
    singleLastUpdatedAt: null,
  };
}
