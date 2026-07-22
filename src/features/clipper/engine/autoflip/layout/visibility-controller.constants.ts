import type { VisibilityControllerParams, VisibilityControllerState } from "../../types/autoflip-layout.types";

export const LEGACY_VISIBILITY_PARAMS: Readonly<VisibilityControllerParams> = Object.freeze({
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

export const DEFAULT_VISIBILITY_PARAMS: Readonly<VisibilityControllerParams> = Object.freeze({
  ...LEGACY_VISIBILITY_PARAMS,
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

export const ITERATION10_VISIBILITY_CONTROLLER_PARAMS = DEFAULT_VISIBILITY_PARAMS;

/** @deprecated Use DEFAULT_VISIBILITY_PARAMS */
export const RUN9_VISIBILITY_CONTROLLER_PARAMS = LEGACY_VISIBILITY_PARAMS;

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
