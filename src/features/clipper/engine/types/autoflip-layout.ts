import type {
  AutoFlipAspectTrack,
  ClipperLayoutMode,
  ClipperLayoutStrategy,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop";

export interface ArbiterParams {
  /** Divisor mapping proposal-score improvement to decisionConfidence. */
  decisionConfidenceScale: number;
  /** Allow split proposals to win arbitration. */
  allowSplit?: boolean;
  /** Allow contain proposals to win arbitration. */
  allowContain?: boolean;
  /** Minimal union crop for 3+ person groups (handoff §3.4). */
  allowGroupUnion?: boolean;
}

/** Everything the arbiter needs for one layout sample. */
export interface ArbiterSampleContext {
  desiredMode: ClipperLayoutMode;
  baselineScore: number;
  semanticScore: number;
  /** The visibility controller's decision, if it ran. Absence means fall back to baseline. */
  controllerReasonCodes?: string[];
}

export interface ArbiterDecision {
  selectSemantic: boolean;
  strategy: ClipperLayoutStrategy;
  reasonCodes: string[];
  decisionConfidence: number;
}

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
export interface VisibilityFramingState {
  primaryId: string | null;
  observedKeyframes: number;
  previousViewport: NormalizedBox | null;
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
