// v47: one size and a smooth in-corridor path per split stretch, panels
// clamped to the active picture, held layouts dropped when they show nobody,
// adaptive shot cuts and burned-in band removal. Older blobs are re-analysed.
export const AUTOFLIP_ANALYZER_VERSION = "autoflip-v47-stable-split-panels";
/**
 * Analyzer version for a session. ASD v46: offline speaker turns additionally
 * drive the conversation layout planner (fixed per-person panels, speaker on
 * top); footage outside detected conversations follows the regular path.
 */
export function activeSpeakerAnalyzerVersion(enabled = false): string {
  return enabled ? "autoflip-v46-light-asd-conversation-layout" : AUTOFLIP_ANALYZER_VERSION;
}
/**
 * Speaker-turn segmentation (offline Viterbi over Light-ASD probabilities).
 * Evidence is measured in logit-seconds, so none of these depend on the clip
 * length or the detector sample rate.
 *
 * - Switch penalty: a change of speaker needs this much accumulated evidence;
 *   a clear speaker (p≈0.9 vs 0.1) earns ≈2.2/s, i.e. ~0.7 s of speech.
 * - Minimum turn: an editor does not cut to a listener's "mhm"; shorter
 *   turns are absorbed by the surrounding speaker.
 * - Probability clamp bounds a single over-confident window (|logit| ≤ 3.9).
 */
export const ACTIVE_SPEAKER_SWITCH_PENALTY = 1.5;
export const ACTIVE_SPEAKER_MIN_TURN_SEC = 2;
export const ACTIVE_SPEAKER_PROBABILITY_CLAMP = 0.02;
/** A face's own quiet level: most people are silent most of a conversation. */
export const ACTIVE_SPEAKER_SILENT_PERCENTILE = 0.2;
export const ACTIVE_SPEAKER_MAX_SAMPLE_GAP_SEC = 0.6;
/**
 * Conversation layout planner. A stretch is a conversation only when every
 * test holds; each one rejects a different class of non-conversation footage.
 *
 * - Presence: each participant is visible in this share of a window's samples.
 * - Minimum duration: longer than typical music-video / montage shots (1–5 s).
 * - Seated: each face's 10–90th percentile centre range stays within this
 *   multiple of its own size (rules out dancing, sport, walk-and-talk).
 * - Turn taking: at least two participants speak for a full speaker turn.
 * - Window / bridge: presence is judged per window; a shorter blip in
 *   detections between identical windows does not end the conversation.
 */
export const CONVERSATION_MIN_PRESENCE = 0.8;
export const CONVERSATION_MIN_DURATION_SEC = 6;
export const CONVERSATION_MAX_FACE_TRAVEL = 1;
export const CONVERSATION_MIN_SPEAKERS = 2;
export const CONVERSATION_WINDOW_SEC = 2;
export const CONVERSATION_BRIDGE_SEC = 4;
/** A panel shows head and shoulders: the face is at least this share of the panel height. */
export const CONVERSATION_MIN_FACE_PANEL_HEIGHT = 0.25;
/** The graph-compatible object model identity. */
export const AUTOFLIP_MODEL_ID = "clipper-vision-v7-yolox-s-yunet-multiscale";
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
