import type { NormalizedBox } from "../../shared/smart-crop";

// v17 promotes the detector segment router (Iteration 11): eligible segments
// take the shadow-detector candidate geometry with frozen run-4 parameters.
// The Iteration 10 path remains the per-segment fallback.
export const AUTOFLIP_ANALYZER_VERSION = "autoflip-v17-iteration11";
/** The graph-compatible object model identity. */
export const AUTOFLIP_MODEL_ID = "clipper-vision-v2";
export const AUTOFLIP_FIELD_OF_VIEW_DEG = 60;
export const AUTOFLIP_MAX_SCENE_FRAMES = 600;
export const AUTOFLIP_KEYFRAME_INTERVAL_SEC = 0.2;
/** Never shrink the smart-follow window below this fraction of the nominal cover crop. */
export const AUTOFLIP_MIN_ZOOM_SCALE = 0.65;
/**
 * Zoom is a deliberate reframe and needs sustained evidence: fast-cut scenes
 * give the size estimator too few keyframes, and zooming across rapid cuts
 * reads as jitter.  Original scenes shorter than this keep the cover crop.
 */
export const AUTOFLIP_MIN_ZOOM_SCENE_SEC = 8;
/** Matched-aspect footage needs only a short, stable observation to reframe. */
export const AUTOFLIP_MATCHED_ASPECT_MIN_ZOOM_SCENE_SEC = 1;
/** Focus-band diagonal → desired window diagonal multiplier, per headroom setting. */
export const AUTOFLIP_ZOOM_MARGIN: Record<"tight" | "normal" | "wide", number> = {
  tight: 2.8,
  normal: 3.6,
  wide: 4.8,
};

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
  /** Recovery detector evidence may fill a dropout but must not displace stable primary evidence. */
  recoveryOnly?: boolean;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
}

export interface KeyFrameSalientInput {
  time: number;
  regions: SalientRegion[];
  isShotChange: boolean;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

export const DEFAULT_KINEMATIC_OPTIONS: Required<
  Pick<
    KinematicOptions,
    | "reframeWindow"
    | "updateRateSeconds"
    | "maxUpdateRate"
    | "filteringTimeWindowUs"
    | "meanPeriodUpdateRate"
    | "maxDeltaTimeSec"
  >
> = {
  reframeWindow: 0,
  updateRateSeconds: 0.2,
  maxUpdateRate: 0.8,
  filteringTimeWindowUs: 0,
  meanPeriodUpdateRate: 0.25,
  maxDeltaTimeSec: 0,
};
