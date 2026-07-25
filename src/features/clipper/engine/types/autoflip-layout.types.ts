import type {
  AutoFlipAspectTrack,
  ClipperLayoutMode,
  ClipperLayoutStrategy,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop.util";

export interface ArbiterParams {
  /** Divisor mapping proposal-score improvement to decisionConfidence. */
  decisionConfidenceScale: number;
  /** Allow split proposals to win arbitration. */
  allowSplit?: boolean;
  /** Minimal union crop for 3+ person groups (handoff §3.4). */
  allowGroupUnion?: boolean;
  /** Semantic framing must improve the proposal score by this much unless coverage is unsafe. */
  minimumSemanticScoreGain?: number;
  /** A qualified target this poorly covered by baseline may override the normal score margin. */
  emergencyBaselineCoverage?: number;
}

/** Everything the arbiter needs for one layout sample. */
export interface ArbiterSampleContext {
  desiredMode: ClipperLayoutMode;
  baselineScore: number;
  semanticScore: number;
  /** The visibility controller's decision, if it ran. Absence means fall back to baseline. */
  controllerReasonCodes?: string[];
  /** Worst required-region coverage offered by the legacy crop. */
  baselineCoverage?: number;
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
  splitPendingSec?: number;
  mergePendingSec?: number;
  splitVariant?: "v2" | "v3";
  minimumAssociationConfidence?: number;
  maxSwitchesPerMinute?: number;
  riskMergeGapSec?: number;
  identityHoldSec?: number;
}

export type VisibilityMachineState = "common" | "split-pending" | "split-active" | "merge-pending";

export interface VisibilityControllerState {
  scene: number;
  activeMode: ClipperLayoutMode;
  /** One for single crop, two or three for the active split template. */
  activeViewportCount: number;
  modeSince: number;
  riskClearedAt: number | null;
  lastRiskAt: number | null;
  panelOrder: string[];
  previousViewport: NormalizedBox | null;
  machineState: VisibilityMachineState;
  pendingSince: number | null;
  lastSplitViewports: NormalizedBox[];
  lastSplitPanelSubjects: Array<{ id: string; focusBox: NormalizedBox }>;
  identityLostAt: number | null;
  modeSwitchTimestamps: number[];
  sceneStartedAt: number;
  /** Stateful single-subject framing prevents detector noise from retriggering a pan. */
  singlePrimaryId: string | null;
  pendingSinglePrimaryId: string | null;
  pendingSinglePrimarySince: number | null;
  singleViewport: NormalizedBox | null;
  singleVelocity: { x: number; y: number };
  singleLastUpdatedAt: number | null;
}

export interface VisibilityVariant {
  kind:
    | "run8-baseline"
    | "shifted-crop"
    | "wider-crop"
    | "emergency-primary-crop"
    | "stable-split-v2"
    | "stable-split-v3"
    | "stable-split-3";
  mode: ClipperLayoutMode;
  viewports: NormalizedBox[];
  requiredCoverage: number[];
  panelSubjects?: Array<{ id: string; focusBox: NormalizedBox }>;
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
  panelSubjects?: Array<{ id: string; focusBox: NormalizedBox }>;
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
