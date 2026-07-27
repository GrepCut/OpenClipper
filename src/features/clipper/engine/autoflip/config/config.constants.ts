// v43: snap single-primary layout viewport on hard cuts; keep within-scene ease.
export const AUTOFLIP_ANALYZER_VERSION = "autoflip-v43-snap-layout-on-cut";
/** The graph-compatible object model identity. */
export const AUTOFLIP_MODEL_ID = "clipper-vision-v5-yolox-s-scrfd10g-tiled";
export const AUTOFLIP_FIELD_OF_VIEW_DEG = 60;
export const AUTOFLIP_MAX_SCENE_FRAMES = 600;
export const AUTOFLIP_KEYFRAME_INTERVAL_SEC = 0.2;
/** Production tracks are interpolated by the renderer; storing source-FPS paths wastes RAM. */
export const AUTOFLIP_TRACK_FPS = 5;
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

export type {
  FocusPoint,
  FocusPointFrame,
  KeyFrameSalientInput,
  KinematicOptions,
  NormalizedRect,
  SalientRegion,
  SalientSignalType,
  SceneCameraMotionType,
  SceneKeyFrameCropSummary,
} from "../../types/autoflip.types";

import type { KinematicOptions } from "../../types/autoflip.types";

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
