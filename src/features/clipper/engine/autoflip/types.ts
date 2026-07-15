import type { NormalizedBox } from "../../shared/smart-crop";

// v8 makes solid-background/padding decisions per scene, matching the graph.
// Persisted v7 tracks cannot recover per-shot background evidence.
export const AUTOFLIP_ANALYZER_VERSION = "autoflip-v10";
/** The graph-compatible object model identity. */
export const AUTOFLIP_MODEL_ID = "mediapipe-ssdlite-object-detection-320";
export const AUTOFLIP_FIELD_OF_VIEW_DEG = 60;
export const AUTOFLIP_MAX_SCENE_FRAMES = 600;
export const AUTOFLIP_KEYFRAME_INTERVAL_SEC = 0.2;

export type SalientSignalType =
  | "face_core"
  | "face_all"
  | "face_full"
  | "human"
  | "pet"
  | "car"
  | "object";

export interface SalientRegion {
  box: NormalizedBox;
  score: number;
  signalType: SalientSignalType;
  isRequired: boolean;
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
