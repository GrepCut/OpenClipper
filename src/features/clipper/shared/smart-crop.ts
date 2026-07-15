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

export interface SubjectDetectionSample {
  time: number;
  detections: SubjectDetection[];
  autoflipFaces?: AutoFlipFaceDetection[];
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
}
