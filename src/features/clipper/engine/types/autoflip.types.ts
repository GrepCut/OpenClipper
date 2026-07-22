import type { ClipperHeadroom, ClipperSmoothingStrength } from "../../settings/settings.util";
import type { FaceBoxSample } from "../../shared/face-samples.util";
import type {
  AutoFlipStaticFeatureSample,
  ImportanceSignalSample,
  NormalizedBox,
  SubjectDetectionSample,
} from "../../shared/smart-crop.util";
export type { NormalizedBox } from "../../shared/smart-crop.util";
export type NormalizedRect = NormalizedBox;

export type SalientSignalType =
  | "face_core"
  | "face_all"
  | "face_full"
  | "pose_head"
  | "pose_torso"
  | "human"
  | "pet"
  | "car"
  | "object"
  | "head"
  | "screen"
  | "motion"
  | "video_saliency"
  | "active_speaker";

export interface SalientRegion {
  box: NormalizedBox;
  score: number;
  signalType: SalientSignalType;
  isRequired: boolean;
  trackId?: number;
  predicted?: boolean;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
}

export interface KeyFrameSalientInput {
  time: number;
  regions: SalientRegion[];
  isShotChange: boolean;
}

export interface FocusPoint {
  x: number;
  y: number;
  weight: number;
}

export interface FocusPointFrame {
  timeUs: number;
  points: FocusPoint[];
}

export type SceneCameraMotionType = "steady" | "tracking" | "sweeping";

export interface SceneKeyFrameCropSummary {
  sceneFrameWidth: number;
  sceneFrameHeight: number;
  cropWindowWidth: number;
  cropWindowHeight: number;
  motionType: SceneCameraMotionType;
  lookAtCenterX: number;
  lookAtCenterY: number;
  frameSuccessRate?: number;
  horizontalMotionAmount?: number;
  verticalMotionAmount?: number;
  hasSalientRegion?: boolean;
}

export interface KinematicOptions {
  maxVelocity?: number;
  maxVelocityScale?: number;
  maxVelocityShift?: number;
  minMotionToReframe?: number;
  minMotionToReframeLower?: number;
  minMotionToReframeUpper?: number;
  reframeWindow?: number;
  updateRateSeconds?: number;
  maxUpdateRate?: number;
  filteringTimeWindowUs?: number;
  meanPeriodUpdateRate?: number;
  maxDeltaTimeSec?: number;
}

export interface BuildAutoFlipTrackInput {
  clipStart: number;
  clipEnd: number;
  detections: SubjectDetectionSample[];
  faces: FaceBoxSample[];
  sceneCuts: number[];
  /** Legacy primary target.  New callers should supply `targetAspectRatios`. */
  targetAspectRatio?: number;
  /** Every enabled crop output gets its own camera path. */
  targetAspectRatios?: Record<string, number>;
  frameWidth?: number;
  frameHeight?: number;
  smoothing?: ClipperSmoothingStrength;
  /** Reserved for framing margins; the crop window itself never zooms below nominal. */
  headroom?: ClipperHeadroom;
  degradedReason?: string;
  hasSolidColorBackground?: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number };
  /** MediaPipe evaluates solid background independently for each scene. */
  staticFeatureSamples?: AutoFlipStaticFeatureSample[];
  /** Source-space active image area after static letterbox borders are removed. */
  contentRect?: NormalizedBox;
  /** Native decoded frame rate; used for graph-equivalent scene boundaries and paths. */
  sourceFrameRate?: number;
  trackerVersion?: "bytetrack-v1";
  /** Sparse outputs from optional head, saliency, motion or active-speaker analyzers. */
  importanceSignals?: ImportanceSignalSample[];
  /** Attach per-scene diagnostics to the returned blob (benchmark tooling only). */
  collectDebug?: boolean;
  /** Fuse canonical person tracks and active-speaker policy. Omit for legacy identity path. */
  enhancedIdentityFusion?: boolean;
}

export interface SceneMotionInput {
  keyframes: KeyFrameSalientInput[];
  frameWidth: number;
  frameHeight: number;
  targetAspectRatio: number;
  /** MediaPipe's proto default is true. */
  allowSweeping?: boolean;
  hasSolidColorBackground?: boolean;
  /** Every decoded scene-frame timestamp, matching AutoFlip's focus stream. */
  sceneTimestampsUs?: number[];
  /**
   * Window scale (≤1) shared by every chunk of one original scene, letting the
   * crop window shrink toward the focus band so its centre can track subjects
   * vertically as well as horizontally.  1 keeps the classic cover crop.
   */
  cropScale?: number;
}

export interface SceneMotionResult {
  summary: SceneKeyFrameCropSummary;
  keyframeCrops: Array<{ time: number; rect: NormalizedRect }>;
  focusPointFrames: FocusPointFrame[];
}

export interface SceneZoomInput {
  keyframes: KeyFrameSalientInput[];
  frameWidth: number;
  frameHeight: number;
  targetAspectRatio: number;
  /** Focus-band diagonal → desired window diagonal multiplier. */
  margin: number;
  minScale: number;
}

export interface SceneCropInput {
  summary: SceneKeyFrameCropSummary;
  focusPointFrames: FocusPointFrame[];
  /** Last 30 full-frame points from the preceding forced scene chunk. */
  priorFocusPointFrames?: FocusPointFrame[];
  sceneTimestampsUs: number[];
  isKeyFrames: boolean[];
  kinematicOptions: KinematicOptions;
  continueLastScene?: boolean;
  /** AutoFlip graph uses polynomial regression unless kinematic options are explicitly configured. */
  pathSolver?: "polynomial" | "kinematic";
}

export interface FrameCropRegionInput {
  frameWidth: number;
  frameHeight: number;
  targetAspectRatio: number;
  regions: SalientRegion[];
}

/** Equivalent to AutoFlip's KeyFrameCropResult, in normalized coordinates. */
export interface FrameCropRegionResult {
  region: NormalizedRect;
  regionIsEmpty: boolean;
  requiredRegionIsEmpty: boolean;
  requiredRegion?: NormalizedRect;
  areRequiredRegionsCoveredInTargetSize: boolean;
  fractionNonRequiredCovered: number;
  regionScore: number;
  /** Weighted centre of the highest-priority signal band (faces before bodies before objects). */
  focusCenter?: { x: number; y: number };
  /** Union of the highest-priority signal band; the crop window must keep covering it when zooming. */
  focusBox?: NormalizedRect;
}

export interface BuildSalientKeyframesInput {
  detections: SubjectDetectionSample[];
  sceneCuts: number[];
  clipStart: number;
  clipEnd: number;
  keyframeIntervalSec?: number;
}

export interface ActiveSpeakerPolicy {
  threshold: number;
  runnerUpMargin: number;
  stableMultiFaceSamples: number;
  maximumSampleGapSec: number;
  minimumMultiFaceDurationSec: number;
  minimumHoldSec: number;
}

export interface CanonicalFusionResult {
  samples: SubjectDetectionSample[];
  telemetry: import("../../shared/smart-crop.util").CanonicalIdentityTelemetry;
}
