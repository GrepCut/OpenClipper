import type { NormalizedRect, SalientRegion } from "./types";

type CoverType = "fully" | "partially" | "none";

function expandSegment(
  segmentToAdd: [number, number],
  baseSegment: [number, number],
  maxLength: number,
  minCoverageFraction = 0.5,
): { segment: [number, number]; cover: CoverType } {
  const [addLeft, addRight] = segmentToAdd;
  const [baseLeft, baseRight] = baseSegment;
  const segmentLength = addRight - addLeft;
  const maxLeftout = Math.ceil((1 - minCoverageFraction) * segmentLength / 2);
  const minCoverageLeft = addLeft + maxLeftout;
  const minCoverageRight = addRight - maxLeftout;

  let combinedLeft = Math.min(addLeft, baseLeft);
  let combinedRight = Math.max(addRight, baseRight);
  const minCoverageCombinedLeft = Math.min(minCoverageLeft, baseLeft);
  const minCoverageCombinedRight = Math.max(minCoverageRight, baseRight);

  if (combinedRight - combinedLeft <= maxLength) {
    return { segment: [combinedLeft, combinedRight], cover: "fully" };
  }
  if (minCoverageCombinedRight - minCoverageCombinedLeft <= maxLength) {
    return {
      segment: [minCoverageCombinedLeft, minCoverageCombinedRight],
      cover: "partially",
    };
  }
  return { segment: [baseLeft, baseRight], cover: "none" };
}

function expandRect(
  rectToAdd: NormalizedRect,
  baseRect: NormalizedRect,
  maxWidth: number,
  maxHeight: number,
): { rect: NormalizedRect; cover: CoverType } {
  const horizontal = expandSegment(
    [rectToAdd.x, rectToAdd.x + rectToAdd.width],
    [baseRect.x, baseRect.x + baseRect.width],
    maxWidth,
  );
  const vertical = expandSegment(
    [rectToAdd.y, rectToAdd.y + rectToAdd.height],
    [baseRect.y, baseRect.y + baseRect.height],
    maxHeight,
  );
  if (horizontal.cover === "none" || vertical.cover === "none") {
    return { rect: baseRect, cover: "none" };
  }
  return {
    rect: {
      x: horizontal.segment[0],
      y: vertical.segment[0],
      width: horizontal.segment[1] - horizontal.segment[0],
      height: vertical.segment[1] - vertical.segment[0],
    },
    cover: horizontal.cover === "fully" && vertical.cover === "fully" ? "fully" : "partially",
  };
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
}

function unionRect(a: NormalizedRect, b: NormalizedRect): NormalizedRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function computeFrameCropRegionResult(input: FrameCropRegionInput): FrameCropRegionResult {
  const { frameWidth, frameHeight, targetAspectRatio, regions } = input;
  if (frameWidth <= 0 || frameHeight <= 0 || targetAspectRatio <= 0) {
    return { region: { x: 0, y: 0, width: 1, height: 1 }, regionIsEmpty: true, requiredRegionIsEmpty: true, areRequiredRegionsCoveredInTargetSize: true, fractionNonRequiredCovered: 0, regionScore: 0 };
  }

  const sourceAspect = frameWidth / frameHeight;
  let cropWidthNorm: number;
  let cropHeightNorm: number;
  if (sourceAspect >= targetAspectRatio) {
    cropHeightNorm = 1;
    cropWidthNorm = targetAspectRatio / sourceAspect;
  } else {
    cropWidthNorm = 1;
    cropHeightNorm = sourceAspect / targetAspectRatio;
  }

  if (regions.length === 0) return { region: { x: 0, y: 0, width: 0, height: 0 }, regionIsEmpty: true, requiredRegionIsEmpty: true, areRequiredRegionsCoveredInTargetSize: true, fractionNonRequiredCovered: 0, regionScore: 0 };

  const sorted = [...regions].sort((a, b) => b.score - a.score);
  // Required regions form an unconstrained union first.  That is a key
  // AutoFlip invariant: required content must never be silently discarded.
  const required = sorted.filter((region) => region.isRequired);
  const requiredBox = required.reduce<NormalizedRect | null>((union, region) => union ? unionRect(union, region.box) : { ...region.box }, null);
  // AutoFlip enlarges the target window when the union of required regions is
  // larger than the nominal target. Padding is then handled by the renderer
  // instead of dropping required content.
  if (requiredBox) {
    cropWidthNorm = Math.max(cropWidthNorm, requiredBox.width);
    cropHeightNorm = Math.max(cropHeightNorm, requiredBox.height);
  }
  // Optional regions begin at a zero-sized anchor point. This is deliberately
  // not a nominal crop window: the accumulated region represents salient
  // content, while SceneCameraMotionAnalyzer chooses the final window.
  const anchor = requiredBox ?? sorted[0]!.box;
  const anchorCenterX = anchor.x + anchor.width / 2;
  const anchorCenterY = anchor.y + anchor.height / 2;
  let crop: NormalizedRect = requiredBox
    ? { ...requiredBox }
    : { x: anchorCenterX, y: anchorCenterY, width: 0, height: 0 };
  let aggregateScore = required.length ? 1 : 0; // graph uses CONSTANT aggregation in AutoFlip.
  let fullyCovered = 0;
  const optional = sorted.filter((region) => !region.isRequired);

  for (const region of sorted) {
    if (region.isRequired) continue;
    const expanded = expandRect(region.box, crop, cropWidthNorm, cropHeightNorm);
    if (expanded.cover !== "none") {
      crop = expanded.rect;
      if (expanded.cover === "fully") fullyCovered++;
      if (expanded.cover === "fully") aggregateScore = 1;
    }
  }

  return {
    region: { ...crop },
    regionIsEmpty: false,
    requiredRegionIsEmpty: required.length === 0,
    requiredRegion: requiredBox ?? undefined,
    areRequiredRegionsCoveredInTargetSize: !requiredBox || (requiredBox.width <= cropWidthNorm && requiredBox.height <= cropHeightNorm),
    fractionNonRequiredCovered: optional.length ? fullyCovered / optional.length : 0,
    regionScore: aggregateScore,
  };
}

export function computeFrameCropRegion(input: FrameCropRegionInput): NormalizedRect {
  return computeFrameCropRegionResult(input).region;
}

export function cropRectToCentroid(rect: NormalizedRect): { x: number; y: number; extent: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    extent: Math.hypot(rect.width, rect.height),
  };
}

export function computeTargetCropSize(
  frameWidth: number,
  frameHeight: number,
  targetAspectRatio: number,
): { cropWidth: number; cropHeight: number } {
  const sourceAspect = frameWidth / frameHeight;
  if (sourceAspect >= targetAspectRatio) {
    return { cropWidth: frameHeight * targetAspectRatio, cropHeight: frameHeight };
  }
  return { cropWidth: frameWidth, cropHeight: frameWidth / targetAspectRatio };
}
