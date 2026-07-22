import { KinematicPathSolver } from "./kinematic-solver";
import type { FocusPointFrame, KinematicOptions, NormalizedRect, SceneKeyFrameCropSummary } from "../config/constants";
import { AUTOFLIP_FIELD_OF_VIEW_DEG } from "../config/constants";
import { solveAutoFlipPolynomialPath } from "./polynomial-solver";

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

export function cropScenePath(input: SceneCropInput): NormalizedRect[] {
  const { summary, focusPointFrames, sceneTimestampsUs, isKeyFrames, kinematicOptions } = input;
  const frameWidth = summary.sceneFrameWidth;
  const frameHeight = summary.sceneFrameHeight;
  const cropWidthNorm = summary.cropWindowWidth / frameWidth;
  const cropHeightNorm = summary.cropWindowHeight / frameHeight;

  if ((input.pathSolver ?? "polynomial") === "polynomial") {
    const xs = solveAutoFlipPolynomialPath(focusPointFrames, "x", sceneTimestampsUs, input.priorFocusPointFrames);
    const ys = solveAutoFlipPolynomialPath(focusPointFrames, "y", sceneTimestampsUs, input.priorFocusPointFrames);
    return sceneTimestampsUs.map((_, index) => ({
      x: Math.max(0, Math.min(1 - cropWidthNorm, xs[index]! - cropWidthNorm / 2)),
      y: Math.max(0, Math.min(1 - cropHeightNorm, ys[index]! - cropHeightNorm / 2)),
      width: cropWidthNorm,
      height: cropHeightNorm,
    }));
  }

  const minX = summary.cropWindowWidth / 2;
  const maxX = summary.sceneFrameWidth - summary.cropWindowWidth / 2;
  const minY = summary.cropWindowHeight / 2;
  const maxY = summary.sceneFrameHeight - summary.cropWindowHeight / 2;
  const pixelsPerDegree = frameWidth / AUTOFLIP_FIELD_OF_VIEW_DEG;

  const xSolver = new KinematicPathSolver(kinematicOptions, minX, maxX, pixelsPerDegree);
  const ySolver = new KinematicPathSolver(kinematicOptions, minY, maxY, pixelsPerDegree);

  const crops: NormalizedRect[] = [];
  let hasObservation = false;

  for (let index = 0; index < sceneTimestampsUs.length; index++) {
    const timestampUs = sceneTimestampsUs[index]!;
    const isKeyframe = isKeyFrames[index] || !hasObservation;
    if (isKeyframe) {
      const focus = focusPointFrames[index] ?? focusPointFrames.at(-1) ?? {
        points: [{ x: 0.5, y: 0.5, weight: 1 }],
      };
      const observedX = Math.round((focus.points[0]?.x ?? 0.5) * frameWidth);
      const observedY = Math.round((focus.points[0]?.y ?? 0.5) * frameHeight);
      xSolver.addObservation(observedX, timestampUs);
      ySolver.addObservation(observedY, timestampUs);
      hasObservation = true;
    } else {
      xSolver.updatePrediction(timestampUs);
      ySolver.updatePrediction(timestampUs);
    }

    const centerX = xSolver.getState() / frameWidth;
    const centerY = ySolver.getState() / frameHeight;
    crops.push({
      x: centerX - cropWidthNorm / 2,
      y: centerY - cropHeightNorm / 2,
      width: cropWidthNorm,
      height: cropHeightNorm,
    });
  }

  return crops;
}

export function buildSceneTimeline(startSec: number, endSec: number, fps = 30, includeEnd = true): {
  timestampsUs: number[];
  isKeyFrames: boolean[];
} {
  const stepSec = 1 / fps;
  const keyframeStepSec = 0.2;
  const timestampsUs: number[] = [];
  const isKeyFrames: boolean[] = [];
  for (let time = startSec; time < endSec - 1e-9 || (includeEnd && time <= endSec + 1e-9); time += stepSec) {
    timestampsUs.push(Math.round(time * 1_000_000));
    isKeyFrames.push(Math.abs(time / keyframeStepSec - Math.round(time / keyframeStepSec)) < stepSec * 0.5);
  }
  if (includeEnd && timestampsUs.at(-1) !== Math.round(endSec * 1_000_000)) {
    timestampsUs.push(Math.round(endSec * 1_000_000));
    isKeyFrames.push(false);
  }
  return { timestampsUs, isKeyFrames };
}
