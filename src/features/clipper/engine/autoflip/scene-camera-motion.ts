import type { FocusPointFrame, KeyFrameSalientInput, NormalizedRect, SceneCameraMotionType, SceneKeyFrameCropSummary } from "./types";
import { computeFrameCropRegionResult, computeTargetCropSize, cropRectToCentroid, focusBandRegions } from "./frame-crop-region";

const STEADY_MOTION_THRESHOLD = 0.5;
const STEADY_CENTER_DEADBAND = 0.08;

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

function rectCenter(rect: NormalizedRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function clampCenter(center: number, cropSize: number): number {
  return Math.max(cropSize / 2, Math.min(1 - cropSize / 2, center));
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
  hasPersistentTrack: boolean,
): SceneCameraMotionType {
  if (!hasSalientRegion) return "steady";
  if (allowSweeping && !hasSolidColorBackground && !hasPersistentTrack && successRate < 0.4 && sceneSpanSec >= 1) return "sweeping";
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
  const cropScale = Math.min(1, Math.max(0.05, input.cropScale ?? 1));
  const scaledTargetWidthNorm = targetWidthNorm * cropScale;
  const scaledTargetHeightNorm = targetHeightNorm * cropScale;

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
  // (possibly zoomed) target before computing motion and tracking
  // interpolation.  Each rect keeps the accumulated union's size but is
  // recentred on the focus band, so faces steer position while the union
  // still informs coverage.
  const keyframeCrops = nonEmptyResults.map(({ time, result }) => {
    const focus = result.focusCenter;
    const rect = focus
      ? { ...result.region, x: focus.x - result.region.width / 2, y: focus.y - result.region.height / 2 }
      : result.region;
    return { time, rect: clampKeyframeCenter(rect, scaledTargetWidthNorm, scaledTargetHeightNorm) };
  });
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
  const trackedFrameCounts = new Map<number, number>();
  for (const keyframe of input.keyframes) {
    const ids = new Set(focusBandRegions(keyframe.regions).filter((region) => !region.predicted && region.trackId != null).map((region) => region.trackId!));
    for (const id of ids) trackedFrameCounts.set(id, (trackedFrameCounts.get(id) ?? 0) + 1);
  }
  const hasPersistentTrack = [...trackedFrameCounts.values()].some((count) => count >= 2);
  const requestedMotionType = decideMotionType(motionAmount, successRate, sceneSpanSec, input.allowSweeping ?? true, Boolean(input.hasSolidColorBackground), hasSalientRegion, hasPersistentTrack);
  const keyframeCenters = keyframeCrops.map((item) => rectCenter(item.rect));

  // The scene window is the maximum of the (possibly zoomed) target and the
  // focus-band unions; the reference performs this aggregation before motion.
  // Bounding by the focus band rather than the full union keeps every face
  // covered while still letting the window shrink past a body box that spans
  // most of the frame.
  const aggregatedCropWidthNorm = Math.max(scaledTargetWidthNorm, ...nonEmptyResults.map(({ result }) => (result.focusBox ?? result.region).width));
  const aggregatedCropHeightNorm = Math.max(scaledTargetHeightNorm, ...nonEmptyResults.map(({ result }) => (result.focusBox ?? result.region).height));
  // MediaPipe decides the sweep direction from the aggregated scene window,
  // then resets the actual crop window to the nominal target dimensions.
  // A portrait crop already spans the source height, so a vertical sweep has
  // no visible camera travel; sweep across the only remaining axis instead.
  // The sweep decision keeps reasoning about the unscaled window.
  const unscaledAggWidthNorm = Math.max(targetWidthNorm, ...nonEmptyResults.map(({ result }) => result.region.width));
  const sweepHorizontally =
    unscaledAggWidthNorm > targetWidthNorm + 1e-6 || targetHeightNorm >= 1 - 1e-6;
  // The reference supports sweep_entire_frame=false: travel only between the
  // observed keyframe-center bounds. This prevents a valid face cluster on
  // one side of the frame from triggering an unrelated edge-to-edge scan.
  const sweepAxisCenters = keyframeCenters.map((center) => sweepHorizontally ? center.x : center.y);
  const sweepCropSize = sweepHorizontally ? targetWidthNorm : targetHeightNorm;
  const sweepStartCenter = sweepAxisCenters.length
    ? clampCenter(Math.min(...sweepAxisCenters), sweepCropSize)
    : 0.5;
  const sweepEndCenter = sweepAxisCenters.length
    ? clampCenter(Math.max(...sweepAxisCenters), sweepCropSize)
    : 0.5;
  const motionType: SceneCameraMotionType = requestedMotionType === "sweeping"
    && sweepEndCenter - sweepStartCenter <= 1e-6
    ? "steady"
    : requestedMotionType;
  const sceneCropWidthNorm = motionType === "sweeping" ? targetWidthNorm : aggregatedCropWidthNorm;
  const sceneCropHeightNorm = motionType === "sweeping" ? targetHeightNorm : aggregatedCropHeightNorm;

  const centerMinX = keyframeCenters.length ? Math.min(...keyframeCenters.map((center) => center.x)) : 0.5;
  const centerMaxX = keyframeCenters.length ? Math.max(...keyframeCenters.map((center) => center.x)) : 0.5;
  const centerMinY = keyframeCenters.length ? Math.min(...keyframeCenters.map((center) => center.y)) : 0.5;
  const centerMaxY = keyframeCenters.length ? Math.max(...keyframeCenters.map((center) => center.y)) : 0.5;
  let lookAtCenterX = 0.5;
  let lookAtCenterY = 0.5;
  if (motionType === "steady" && hasSalientRegion && keyframeCenters.length > 0) {
    lookAtCenterX = (centerMinX + centerMaxX) / 2;
    lookAtCenterY = (centerMinY + centerMaxY) / 2;
    // A shrunk window makes a snap-to-centre worth more pixels, so the
    // deadband tightens with the zoom scale.
    if (Math.abs(lookAtCenterX - 0.5) < STEADY_CENTER_DEADBAND * cropScale) lookAtCenterX = 0.5;
    if (Math.abs(lookAtCenterY - 0.5) < STEADY_CENTER_DEADBAND * cropScale) lookAtCenterY = 0.5;
  } else if (motionType === "sweeping") {
    if (sweepHorizontally) {
      lookAtCenterX = (sweepStartCenter + sweepEndCenter) / 2;
      lookAtCenterY = (centerMinY + centerMaxY) / 2;
    } else {
      lookAtCenterX = (centerMinX + centerMaxX) / 2;
      lookAtCenterY = (sweepStartCenter + sweepEndCenter) / 2;
    }
  } else if (keyframeCenters.length > 0) {
    const last = keyframeCenters.at(-1)!;
    lookAtCenterX = last.x;
    lookAtCenterY = last.y;
  }
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
            x: sweepHorizontally
              ? sweepStartCenter + (sweepEndCenter - sweepStartCenter) * sweepFraction - sceneCropWidthNorm / 2
              : clampCenter(lookAtCenterX, sceneCropWidthNorm) - sceneCropWidthNorm / 2,
            y: sweepHorizontally
              ? clampCenter(lookAtCenterY, sceneCropHeightNorm) - sceneCropHeightNorm / 2
              : sweepStartCenter + (sweepEndCenter - sweepStartCenter) * sweepFraction - sceneCropHeightNorm / 2,
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

export interface SceneZoomInput {
  keyframes: KeyFrameSalientInput[];
  frameWidth: number;
  frameHeight: number;
  targetAspectRatio: number;
  /** Focus-band diagonal → desired window diagonal multiplier. */
  margin: number;
  minScale: number;
}

/**
 * How far the crop window may shrink toward the focus band for one original
 * scene.  A robust upper percentile across keyframes keeps the scale constant
 * for the scene's whole span, so the camera cannot pump when a subject leans
 * in or a detection flickers.
 */
export function computeSalienceZoomScale(input: SceneZoomInput): number {
  const { cropWidth, cropHeight } = computeTargetCropSize(input.frameWidth, input.frameHeight, input.targetAspectRatio);
  const nominalDiag = Math.hypot(cropWidth, cropHeight);
  if (nominalDiag <= 0) return 1;
  const scales: number[] = [];
  for (const keyframe of input.keyframes) {
    const band = focusBandRegions(keyframe.regions);
    if (!band.length) continue;
    let left = 1;
    let top = 1;
    let right = 0;
    let bottom = 0;
    for (const region of band) {
      left = Math.min(left, region.box.x);
      top = Math.min(top, region.box.y);
      right = Math.max(right, region.box.x + region.box.width);
      bottom = Math.max(bottom, region.box.y + region.box.height);
    }
    const diag = Math.hypot(Math.max(0, right - left) * input.frameWidth, Math.max(0, bottom - top) * input.frameHeight);
    scales.push((diag * input.margin) / nominalDiag);
  }
  if (!scales.length) return 1;
  scales.sort((a, b) => a - b);
  const p80 = scales[Math.min(scales.length - 1, Math.floor(scales.length * 0.8))]!;
  return Math.max(input.minScale, Math.min(1, p80));
}

export { cropRectToCentroid, interpolateAtTime };
