import type { CentroidSample } from "../engine/reframe";

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubjectDetection {
  box: NormalizedBox;
  label: string;
  score: number;
  /** Native ByteTrack identity; absent for the compatible WASM path. */
  trackId?: number;
  /** A short-lived Kalman prediction emitted while the target is occluded. */
  predicted?: boolean;
}

/** Full-range face detector output used only for AutoFlip's landmark signals. */
export interface AutoFlipFaceDetection {
  box: NormalizedBox;
  keypoints: Array<{ x: number; y: number }>;
}

/** Compact pose output retained by the cropper; raw model keypoints stay transient. */
export interface PoseSubject {
  box: NormalizedBox;
  score: number;
  trackId?: number;
  predicted?: boolean;
  headBox?: NormalizedBox;
  torsoBox?: NormalizedBox;
}

export interface SubjectDetectionSample {
  time: number;
  detections: SubjectDetection[];
  autoflipFaces?: AutoFlipFaceDetection[];
  poseSubjects?: PoseSubject[];
  /** Sparse semantic/action proposals aligned to this detector sample. */
  importanceSignals?: ImportanceSignalRegion[];
  /** Detector that produced this sample; persisted only as analysis provenance. */
  modelId?: string;
  /** Present when the exact AutoFlip model could not be initialized. */
  degradedReason?: string;
}

export interface MotionRegion extends NormalizedBox {
  energy: number;
  expansion: number;
}

export interface MotionSample {
  time: number;
  regions: MotionRegion[];
}

/** Optional semantic signals produced by specialised local analyzers. */
export type ImportanceSignalKind =
  | "video-saliency"
  | "active-speaker"
  | "head"
  | "screen"
  | "motion";

export interface ImportanceSignalRegion {
  box: NormalizedBox;
  kind: ImportanceSignalKind;
  confidence: number;
  trackId?: number;
  predicted?: boolean;
}

export interface ImportanceSignalSample {
  time: number;
  regions: ImportanceSignalRegion[];
}

export type ImportanceRegionKind =
  | "face"
  | "head"
  | "speaker"
  | "person"
  | "action"
  | "screen"
  | "object";

export type ImportanceRegionSource =
  | "face"
  | "head"
  | "pose"
  | "person"
  | "object"
  | "motion"
  | "video-saliency"
  | "active-speaker";

/** A temporally ranked editing target, distinct from a raw detector box. */
export interface ImportanceRegion {
  id: string;
  box: NormalizedBox;
  /** Broader region that should remain visible while `box` drives composition. */
  contentBox: NormalizedBox;
  kind: ImportanceRegionKind;
  importanceScore: number;
  confidence: number;
  required: boolean;
  role: "primary" | "secondary" | "candidate";
  sources: ImportanceRegionSource[];
  trackId?: number;
  predicted?: boolean;
}

export interface ImportanceRegionSample {
  time: number;
  regions: ImportanceRegion[];
  cut?: boolean;
}

export type ClipperLayoutMode = "single-crop" | "split" | "contain";
export type ClipperLayoutStrategy =
  | "legacy-baseline"
  | "semantic-single"
  | "semantic-split"
  | "semantic-contain";

/** Source-space render instruction for one instant of one output format. */
export interface ClipperLayoutSample {
  t: number;
  mode: ClipperLayoutMode;
  /** The renderer falls through to the proven v2/Run4 path for legacy-baseline. */
  strategy?: ClipperLayoutStrategy;
  viewports: NormalizedBox[];
  /** Shadow proposal retained even when the baseline wins arbitration. */
  candidateMode?: ClipperLayoutMode;
  candidateViewports?: NormalizedBox[];
  /** Run4 camera-path crop, retained even when the semantic proposal wins. */
  baselineViewports?: NormalizedBox[];
  primaryRegionId?: string;
  requiredRegionIds: string[];
  baselineScore?: number;
  semanticScore?: number;
  decisionConfidence?: number;
  reasonCodes?: string[];
  cut?: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number };
}

export interface ClipperLayoutTrack {
  targetAspectRatio: number;
  samples: ClipperLayoutSample[];
}

/** Static-background observation captured alongside an AutoFlip keyframe. */
export interface AutoFlipStaticFeatureSample {
  time: number;
  hasSolidColorBackground: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number };
}

export type SmartTargetKind = "person" | "object" | "motion" | "face-fallback" | "center";

export interface SmartCropSample extends CentroidSample {
  targetId: string | null;
  kind: SmartTargetKind;
  label?: string;
  score: number;
  box?: NormalizedBox;
}

/**
 * A render instruction emitted by AutoFlip for one output aspect ratio.
 * `crop` is expressed in normalized source coordinates.  Keeping it alongside
 * the legacy centroid samples is intentional: centroids lose the crop size and
 * therefore cannot faithfully reproduce AutoFlip's camera decisions.
 */
export interface AutoFlipCropSample {
  t: number;
  crop: NormalizedBox;
  cut?: boolean;
  /** AutoFlip could not cover all salient regions at this keyframe. */
  hasUncoveredSalient?: boolean;
  /** Per-scene padding colour. Never apply a background decision to another shot. */
  solidBackgroundColor?: { r: number; g: number; b: number };
}

export interface AutoFlipAspectTrack {
  /** Width / height of the output frame. */
  targetAspectRatio: number;
  samples: AutoFlipCropSample[];
}

/** Diagnostic snapshot of one analyzed scene for one output aspect. */
export interface AutoFlipSceneDebug {
  formatId: string;
  start: number;
  end: number;
  motionType: string;
  lookAtCenterX: number;
  lookAtCenterY: number;
  cropWindowWidthNorm: number;
  cropWindowHeightNorm: number;
  successRate?: number;
  keyframes: Array<{
    time: number;
    regions: Array<{ box: NormalizedBox; score: number; signalType: string }>;
    chosenRect?: NormalizedBox;
  }>;
}

export interface ClipperSmartCropBlob {
  analyzerVersion: string;
  modelId: string;
  /** Runtime provenance; the model id remains stable across native/WASM. */
  engine?: "winml" | "wasm";
  /** Present when the native analysis used temporal ByteTrack stabilization. */
  trackerVersion?: "bytetrack-v1";
  clipStart: number;
  clipEnd: number;
  /** Target crop aspect ratio (width / height) used when building the track. */
  targetAspectRatio?: number;
  /** Source-space active image area after static letterbox borders are removed. */
  contentRect?: NormalizedBox;
  /** Stable background colour used by AutoFlip's padding path when available. */
  solidBackgroundColor?: { r: number; g: number; b: number };
  degradedReason?: string;
  samples: SmartCropSample[];
  /** v2: independent, lossless AutoFlip paths for every enabled crop format. */
  aspectTracks?: Record<string, AutoFlipAspectTrack>;
  /** v3: human-importance targets retained for diagnostics and future reranking. */
  importanceSamples?: ImportanceRegionSample[];
  /** v3: format-aware crop/split/contain decisions used before legacy collage logic. */
  layoutTracks?: Record<string, ClipperLayoutTrack>;
  /** Present only when the caller asked for diagnostics; never persisted by production analysis. */
  debug?: AutoFlipSceneDebug[];
}
