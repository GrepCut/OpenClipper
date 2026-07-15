import type { FocusPointFrame, KeyFrameSalientInput, NormalizedRect, SceneCameraMotionType, SceneKeyFrameCropSummary } from "./types";
import { computeFrameCropRegionResult, computeTargetCropSize, cropRectToCentroid } from "./frame-crop-region";

const STEADY_MOTION_THRESHOLD = 0.5;

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
}

export interface SceneMotionResult {
  summary: SceneKeyFrameCropSummary;
  keyframeCrops: Array<{ time: number; rect: NormalizedRect }>;
  focusPointFrames: FocusPointFrame[];
}

function rectCenter(rect: NormalizedRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function motionSpanPercent(
  crops: NormalizedRect[],
  frameWidth: number,
  frameHeight: number,
  targetAspectRatio: number,
): { horizontal: number; vertical: number } {
  if (crops.length <= 1) return { horizontal: 0, vertical: 0 };
  const xs = crops.map((crop) => rectCenter(crop).x * frameWidth);
  const ys = crops.map((crop) => rectCenter(crop).y * frameHeight);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const { cropWidth, cropHeight } = computeTargetCropSize(frameWidth, frameHeight, targetAspectRatio);
  return { horizontal: xSpan / Math.max(1, frameWidth), vertical: ySpan / Math.max(1, frameHeight) };
}

function clampKeyframeCenter(
  rect: NormalizedRect,
  cropWidthNorm: number,
  cropHeightNorm: number,
): NormalizedRect {
  const center = rectCenter(rect);
  const x = Math.max(cropWidthNorm / 2, Math.min(1 - cropWidthNorm / 2, center.x));
  const y = Math.max(cropHeightNorm / 2, Math.min(1 - cropHeightNorm / 2, center.y));
  return { ...rect, x: x - rect.width / 2, y: y - rect.height / 2 };
}

function decideMotionType(
  motion: { horizontal: number; vertical: number },
  successRate: number,
  sceneSpanSec: number,
  allowSweeping: boolean,
  hasSolidColorBackground: boolean,
  hasSalientRegion: boolean,
): SceneCameraMotionType {
  if (!hasSalientRegion) return "steady";
  if (allowSweeping && !hasSolidColorBackground && successRate < 0.4 && sceneSpanSec >= 1) return "sweeping";
  return motion.horizontal < STEADY_MOTION_THRESHOLD && motion.vertical < STEADY_MOTION_THRESHOLD
    ? "steady"
    : "tracking";
}

function interpolateRect(a: NormalizedRect, b: NormalizedRect, t: number): NormalizedRect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

function interpolateAtTime(
  keyframeCrops: Array<{ time: number; rect: NormalizedRect }>,
  time: number,
): NormalizedRect {
  if (keyframeCrops.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (time <= keyframeCrops[0]!.time) return keyframeCrops[0]!.rect;
  const last = keyframeCrops.at(-1)!;
  if (time >= last.time) return last.rect;

  for (let index = 1; index < keyframeCrops.length; index++) {
    const current = keyframeCrops[index]!;
    const previous = keyframeCrops[index - 1]!;
    if (time <= current.time) {
      const span = Math.max(Number.EPSILON, current.time - previous.time);
      const fraction = (time - previous.time) / span;
      return interpolateRect(previous.rect, current.rect, fraction);
    }
  }
  return last.rect;
}

export function analyzeSceneMotion(input: SceneMotionInput): SceneMotionResult {
  const { frameWidth, frameHeight, targetAspectRatio } = input;
  const { cropWidth, cropHeight } = computeTargetCropSize(frameWidth, frameHeight, targetAspectRatio);
  const targetWidthNorm = cropWidth / frameWidth;
  const targetHeightNorm = cropHeight / frameHeight;

  const keyframeResults = input.keyframes.map((keyframe) => ({
    time: keyframe.time,
    result: computeFrameCropRegionResult({
      frameWidth,
      frameHeight,
      targetAspectRatio,
      regions: keyframe.regions,
    }),
  }));

  const nonEmptyResults = keyframeResults.filter((item) => !item.result.regionIsEmpty);
  // AggregateKeyFrameResults clamps each compact keyframe center to the
  // nominal target before computing motion and tracking interpolation.
  const keyframeCrops = nonEmptyResults.map(({ time, result }) => ({
    time,
    rect: clampKeyframeCenter(result.region, targetWidthNorm, targetHeightNorm),
  }));
  const motionAmount = motionSpanPercent(
    keyframeCrops.map((item) => item.rect),
    frameWidth,
    frameHeight,
    targetAspectRatio,
  );
  const hasSalientRegion = keyframeResults.some((item) => !item.result.regionIsEmpty);
  // The stock graph's configured signals are optional, making its
  // `are_required_regions_covered_in_target_size` trivially true.  For a
  // browser cropper that would make sweeping unreachable precisely when a
  // frame contains too many optional subjects to fit.  Use optional coverage
  // as the equivalent success signal while still requiring all required
  // regions to be covered when they exist.
  const successRate = keyframeResults.length
    ? keyframeResults.reduce((sum, item) => sum + (
      item.result.areRequiredRegionsCoveredInTargetSize
        ? item.result.fractionNonRequiredCovered
        : 0
    ), 0) / keyframeResults.length
    : 0;
  const sceneTimes = input.sceneTimestampsUs?.map((time) => time / 1_000_000) ?? input.keyframes.map((keyframe) => keyframe.time);
  const sceneSpanSec = Math.max(0, (sceneTimes.at(-1) ?? 0) - (sceneTimes[0] ?? 0));
  const motionType = decideMotionType(motionAmount, successRate, sceneSpanSec, input.allowSweeping ?? true, Boolean(input.hasSolidColorBackground), hasSalientRegion);

  let lookAtCenterX = 0.5;
  let lookAtCenterY = 0.5;
  if (motionType === "steady" && hasSalientRegion && keyframeCrops.length > 0) {
    const centers = keyframeCrops.map((item) => rectCenter(item.rect));
    lookAtCenterX = (Math.min(...centers.map((center) => center.x)) + Math.max(...centers.map((center) => center.x))) / 2;
    lookAtCenterY = (Math.min(...centers.map((center) => center.y)) + Math.max(...centers.map((center) => center.y))) / 2;
    if (Math.abs(lookAtCenterX - 0.5) < 0.08) lookAtCenterX = 0.5;
    if (Math.abs(lookAtCenterY - 0.5) < 0.08) lookAtCenterY = 0.5;
  } else if (keyframeCrops.length > 0) {
    const last = rectCenter(keyframeCrops.at(-1)!.rect);
    lookAtCenterX = last.x;
    lookAtCenterY = last.y;
  }

  // The scene window is the maximum of the nominal target and all populated
  // keyframe regions; the reference performs this aggregation before motion.
  const aggregatedCropWidthNorm = Math.max(targetWidthNorm, ...nonEmptyResults.map(({ result }) => result.region.width));
  const aggregatedCropHeightNorm = Math.max(targetHeightNorm, ...nonEmptyResults.map(({ result }) => result.region.height));
  // MediaPipe decides the sweep direction from the aggregated scene window,
  // then resets the actual crop window to the nominal target dimensions.
  // A portrait crop already spans the source height, so a vertical sweep has
  // no visible camera travel; sweep across the only remaining axis instead.
  const sweepHorizontally =
    aggregatedCropWidthNorm > targetWidthNorm + 1e-6 || targetHeightNorm >= 1 - 1e-6;
  const sceneCropWidthNorm = motionType === "sweeping" ? targetWidthNorm : aggregatedCropWidthNorm;
  const sceneCropHeightNorm = motionType === "sweeping" ? targetHeightNorm : aggregatedCropHeightNorm;
  const steadyRect: NormalizedRect = {
    x: Math.max(0, Math.min(1 - sceneCropWidthNorm, lookAtCenterX - sceneCropWidthNorm / 2)),
    y: Math.max(0, Math.min(1 - sceneCropHeightNorm, lookAtCenterY - sceneCropHeightNorm / 2)),
    width: sceneCropWidthNorm,
    height: sceneCropHeightNorm,
  };

  const focusTimes = sceneTimes.length ? sceneTimes : [input.keyframes[0]?.time ?? 0];
  const focusPointFrames: FocusPointFrame[] = [];

  for (const time of focusTimes) {
    const frameIndex = focusPointFrames.length;
    const sweepFraction = focusTimes.length > 1 ? frameIndex / (focusTimes.length - 1) : 0;
    const rect =
      motionType === "steady"
        ? steadyRect
        : motionType === "sweeping"
          ? {
            x: sweepHorizontally ? sweepFraction - sceneCropWidthNorm / 2 : 0.5 - sceneCropWidthNorm / 2,
            y: sweepHorizontally ? 0.5 - sceneCropHeightNorm / 2 : sweepFraction - sceneCropHeightNorm / 2,
            width: sceneCropWidthNorm,
            height: sceneCropHeightNorm,
          }
        : interpolateAtTime(keyframeCrops, time);
    const center = rectCenter(rect);
    const points = sceneCropHeightNorm >= 1 - 1e-6
      ? [{ x: center.x, y: 0, weight: 1 }, { x: center.x, y: 1, weight: 1 }]
      : sceneCropWidthNorm >= 1 - 1e-6
        ? [{ x: 0, y: center.y, weight: 1 }, { x: 1, y: center.y, weight: 1 }]
        : [{ x: center.x, y: center.y, weight: 1 }];
    focusPointFrames.push({ timeUs: Math.round(time * 1_000_000), points });
  }

  return {
    summary: {
      sceneFrameWidth: frameWidth,
      sceneFrameHeight: frameHeight,
      cropWindowWidth: sceneCropWidthNorm * frameWidth,
      cropWindowHeight: sceneCropHeightNorm * frameHeight,
      motionType,
      lookAtCenterX,
      lookAtCenterY,
      frameSuccessRate: successRate,
      horizontalMotionAmount: motionAmount.horizontal,
      verticalMotionAmount: motionAmount.vertical,
      hasSalientRegion,
    },
    keyframeCrops,
    focusPointFrames,
  };
}

export { cropRectToCentroid, interpolateAtTime };
