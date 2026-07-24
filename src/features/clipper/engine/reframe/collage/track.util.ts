import type { ClipperAspectPresetId } from "../../../shared/formats.util";
import type { NormalizedBox, SubjectDetectionSample } from "../../../shared/smart-crop.util";
import { computeTargetCropSize } from "../../autoflip/geometry/frame-crop-region.util";
import {
  createFocusStabilizer,
  cropRectForCentroid,
  FACE_SAMPLE_INTERVAL_SEC,
  faceToCentroid,
  stabilizeFocusCentroid,
} from "../index";
import type { ClipperHeadroom } from "../../../settings/settings.util";
import type { FaceBox, FaceBoxSample } from "../../../shared/face-samples.util";
import type {
  CollageAspectEligibility,
  CollageEligibilityWindow,
  CollageRegion,
  CollageTracks,
  FacePair,
} from "../../types/collage.types";
import type { CentroidSample } from "../../types/reframe.types";

/** Confirm quickly, but tolerate brief detector dropouts once split-screen is active. */
const REGION_ENTER_SAMPLES = 2;
const REGION_EXIT_SAMPLES = 3;
const DUPLICATE_FACE_OVERLAP = 0.5;
const AMBIGUOUS_THIRD_FACE_AREA_RATIO = 0.5;
/** A split only makes sense when its two source crops are materially distinct. */
const MAX_COLLAGE_CROP_OVERLAP = 0.2;

const COLLAGE_ASPECT_RATIOS: Record<ClipperAspectPresetId, number> = {
  "16-9": 16 / 9,
  "9-16": 9 / 16,
  "1-1": 1,
  "4-5": 4 / 5,
};

function faceArea(face: FaceBox): number {
  return Math.max(0, face.width) * Math.max(0, face.height);
}

function intersectionArea(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

/**
 * MediaPipe's TrackedDetection::IsSameAs uses overlap divided by either
 * detection area, rather than IoU. Dividing by the smaller area is the same
 * containment-sensitive test and catches duplicate boxes of different sizes.
 */
export function overlapFractionOfSmaller(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 ? intersectionArea(a, b) / smallerArea : 0;
}

/** Picks two unambiguous, dominant faces and removes detector duplicates. */
export function selectDominantFacePair(faces: FaceBox[]): FacePair | null {
  const byArea = [...faces].filter((face) => faceArea(face) > 0).sort((a, b) => faceArea(b) - faceArea(a));
  const distinct: FaceBox[] = [];
  for (const face of byArea) {
    if (distinct.some((accepted) => overlapFractionOfSmaller(face, accepted) >= DUPLICATE_FACE_OVERLAP)) continue;
    distinct.push(face);
  }
  if (distinct.length < 2) return null;
  if (distinct[2] && faceArea(distinct[2]) >= faceArea(distinct[1]!) * AMBIGUOUS_THIRD_FACE_AREA_RATIO) return null;

  const first = distinct[0]!;
  const second = distinct[1]!;
  return first.x + first.width / 2 <= second.x + second.width / 2
    ? { left: first, right: second }
    : { left: second, right: first };
}

/** Where a head sits inside a person detection box, when no face detector confirmed one. */
const HEAD_BAND_WIDTH_FRACTION = 0.6;
const HEAD_BAND_HEIGHT_FRACTION = 0.22;
const HEAD_MIN_DETECTION_SCORE = 0.5;
const HEAD_MAX_SAMPLE_DELTA_SEC = 0.25;
/** WASM detections carry no track id; require positional stability across consecutive samples instead. */
const HEAD_POSITION_TOLERANCE = 0.05;

/**
 * Face detectors miss profile and partially occluded faces that the person
 * detector still tracks, which silently disables split-screen for real
 * two-speaker shots.  Append an estimated head box for each persistent,
 * confident person detection that no detected face overlaps.  Only the
 * collage derivations should consume the result — the single-focus "largest"
 * strategy must keep seeing real faces only.
 */
export function augmentFaceSamplesWithDetectedHeads(
  faceSamples: FaceBoxSample[],
  detectionSamples: SubjectDetectionSample[],
): FaceBoxSample[] {
  if (!faceSamples.length || !detectionSamples.length) return faceSamples;
  const sorted = [...detectionSamples].sort((a, b) => a.time - b.time);
  return faceSamples.map((sample) => {
    let index = -1;
    let bestDelta = HEAD_MAX_SAMPLE_DELTA_SEC;
    for (let i = 0; i < sorted.length; i++) {
      const delta = Math.abs(sorted[i]!.time - sample.time);
      if (delta < bestDelta) {
        bestDelta = delta;
        index = i;
      }
    }
    if (index < 0) return sample;
    const current = sorted[index]!;
    const previous = sorted[index - 1];
    const synthetic: FaceBox[] = [];
    const poseHeads = (current.poseSubjects ?? []).flatMap((pose) => pose.headBox ? [{
      box: pose.headBox,
      score: pose.score,
      trackId: pose.trackId,
      predicted: pose.predicted,
    }] : []);
    const detectedHeads = current.detections.flatMap((detection) => detection.label.toLowerCase() === "person" ? [{
      box: {
        x: detection.box.x + (detection.box.width * (1 - HEAD_BAND_WIDTH_FRACTION)) / 2,
        y: detection.box.y,
        width: detection.box.width * HEAD_BAND_WIDTH_FRACTION,
        height: detection.box.height * HEAD_BAND_HEIGHT_FRACTION,
      },
      score: detection.score,
      trackId: detection.trackId,
      predicted: detection.predicted,
    }] : []);
    for (const detection of [...poseHeads, ...detectedHeads]) {
      if (detection.predicted || detection.score < HEAD_MIN_DETECTION_SCORE) continue;
      const persistent = detection.trackId != null
        ? ((previous?.poseSubjects?.some((d) => d.trackId === detection.trackId) ?? false)
          || (previous?.detections.some((d) => d.trackId === detection.trackId) ?? false))
        : ([...(previous?.poseSubjects?.map((pose) => pose.headBox).filter(Boolean) ?? []), ...(previous?.detections.map((d) => d.box) ?? [])]
          .some((box) => Math.abs((box!.x + box!.width / 2) - (detection.box.x + detection.box.width / 2)) <= HEAD_POSITION_TOLERANCE
            && Math.abs((box!.y + box!.height / 2) - (detection.box.y + detection.box.height / 2)) <= HEAD_POSITION_TOLERANCE));
      if (!persistent) continue;
      const head: FaceBox = {
        x: detection.box.x * sample.frameW,
        y: detection.box.y * sample.frameH,
        width: detection.box.width * sample.frameW,
        height: detection.box.height * sample.frameH,
      };
      if (head.width <= 0 || head.height <= 0) continue;
      const overlapsExisting = sample.faces.some((face) => overlapFractionOfSmaller(face, head) > 0)
        || synthetic.some((face) => overlapFractionOfSmaller(face, head) > 0);
      if (!overlapsExisting) synthetic.push(head);
    }
    return synthetic.length ? { ...sample, faces: [...sample.faces, ...synthetic] } : sample;
  });
}

/**
 * Splits whole-clip face samples into two independently-tracked speaker
 * regions by horizontal frame position (left-of-center -> top half, right ->
 * bottom half). `hasTwoSpeakers` only goes true once both sides show a real,
 * sustained presence — a single stray misdetection on one side isn't enough.
 */
export function deriveCollageTracks(
  samples: FaceBoxSample[],
): CollageTracks {
  const regions = deriveTwoSpeakerRegions(samples);
  return buildCollageTracksForRegions(samples, regions, []);
}

/**
 * Splits whole-clip face samples into contiguous windows where two speakers
 * are stably present side by side, each with a fixed top/bottom assignment
 * decided once for its whole span (whichever side has the larger cumulative
 * on-screen presence) — so the split never flips mid-region.
 */
export function deriveTwoSpeakerRegions(samples: FaceBoxSample[]): CollageRegion[] {
  const regions: CollageRegion[] = [];
  if (samples.length === 0) return regions;

  let openStart: number | null = null;
  let qualifyingRun = 0;
  let disqualifyingRun = 0;
  let leftScore = 0;
  let rightScore = 0;

  const closeRegion = (endTime: number) => {
    if (openStart == null) return;
    const topIsLeft = leftScore >= rightScore;
    const startBucket = Math.round(openStart / FACE_SAMPLE_INTERVAL_SEC);
    regions.push({ id: `r${startBucket}`, start: openStart, end: endTime, topIsLeft });
    openStart = null;
    leftScore = 0;
    rightScore = 0;
  };

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const pair = selectDominantFacePair(sample.faces);
    const leftFace = pair?.left;
    const rightFace = pair?.right;
    const bothPresent = pair != null;

    if (sample.sceneCut) {
      if (openStart != null) closeRegion(samples[Math.max(0, i - 1)]?.time ?? sample.time);
      qualifyingRun = 0;
      disqualifyingRun = 0;
    }

    if (bothPresent) {
      qualifyingRun++;
      disqualifyingRun = 0;
    } else {
      disqualifyingRun++;
      qualifyingRun = 0;
    }

    if (openStart == null && qualifyingRun >= REGION_ENTER_SAMPLES) {
      const openIndex = Math.max(0, i - REGION_ENTER_SAMPLES + 1);
      openStart = samples[openIndex]!.time;
    }

    if (openStart != null) {
      if (leftFace) leftScore += faceToCentroid(leftFace, sample.frameW, sample.frameH).extent;
      if (rightFace) rightScore += faceToCentroid(rightFace, sample.frameW, sample.frameH).extent;

      if (disqualifyingRun >= REGION_EXIT_SAMPLES) {
        const closeIndex = Math.max(0, i - REGION_EXIT_SAMPLES + 1);
        closeRegion(samples[closeIndex]!.time);
      }
    }
  }

  if (openStart != null) closeRegion(samples[samples.length - 1]!.time);

  return regions;
}

/** Region covering time `t`, if any — regions are disjoint and in ascending time order. */
export function findActiveRegion(regions: CollageRegion[], t: number): CollageRegion | null {
  for (const region of regions) {
    if (t >= region.start && t <= region.end) return region;
  }
  return null;
}

/**
 * Builds top/bottom tracks from `regions`, skipping any region whose id is in
 * `disabledRegionIds` and choosing each enabled region's top/bottom side from
 * its pre-decided `topIsLeft` (fixed for the region's whole span — no
 * mid-region swaps), instead of unconditionally putting left on top.
 */
export function buildCollageTracksForRegions(
  samples: FaceBoxSample[],
  regions: CollageRegion[],
  disabledRegionIds: string[],
): CollageTracks {
  const top: CentroidSample[] = [];
  const bottom: CentroidSample[] = [];
  const disabled = new Set(disabledRegionIds);
  const enabledRegions = regions.filter((r) => !disabled.has(r.id));

  let regionIndex = 0;
  const topStabilizer = createFocusStabilizer();
  const bottomStabilizer = createFocusStabilizer();

  for (const sample of samples) {
    while (regionIndex < enabledRegions.length && sample.time > enabledRegions[regionIndex]!.end) {
      regionIndex++;
      Object.assign(topStabilizer, createFocusStabilizer());
      Object.assign(bottomStabilizer, createFocusStabilizer());
    }
    const region = enabledRegions[regionIndex];
    if (!region || sample.time < region.start || sample.faces.length === 0) continue;

    const pair = selectDominantFacePair(sample.faces);
    const topFace = region.topIsLeft ? pair?.left : pair?.right;
    const bottomFace = region.topIsLeft ? pair?.right : pair?.left;

    if (topFace) {
      const centroid = faceToCentroid(topFace, sample.frameW, sample.frameH);
      const stabilized = stabilizeFocusCentroid(topStabilizer, centroid, sample.time, sample.sceneCut);
      top.push({ t: sample.time, ...stabilized, cut: sample.sceneCut });
    }

    if (bottomFace) {
      const centroid = faceToCentroid(bottomFace, sample.frameW, sample.frameH);
      const stabilized = stabilizeFocusCentroid(bottomStabilizer, centroid, sample.time, sample.sceneCut);
      bottom.push({ t: sample.time, ...stabilized, cut: sample.sceneCut });
    }
  }

  return { top, bottom, hasTwoSpeakers: enabledRegions.length > 0 };
}

function normalizeFaceBox(face: FaceBox, frameW: number, frameH: number): NormalizedBox {
  return {
    x: face.x / frameW,
    y: face.y / frameH,
    width: face.width / frameW,
    height: face.height / frameH,
  };
}

function unionBoxes(a: NormalizedBox, b: NormalizedBox): NormalizedBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** AutoFlip's SetKeyFrameCropTarget + required-region-union fit test. */
export function facesFitSingleCrop(
  pair: FacePair,
  frameW: number,
  frameH: number,
  targetAspectRatio: number,
): boolean {
  const target = computeTargetCropSize(frameW, frameH, targetAspectRatio);
  const union = unionBoxes(normalizeFaceBox(pair.left, frameW, frameH), normalizeFaceBox(pair.right, frameW, frameH));
  return union.width <= target.cropWidth / frameW + Number.EPSILON
    && union.height <= target.cropHeight / frameH + Number.EPSILON;
}

function splitCropsAreDistinct(
  pair: FacePair,
  frameW: number,
  frameH: number,
  outputAspectRatio: number,
  headroom: ClipperHeadroom,
): boolean {
  const panelAspectRatio = outputAspectRatio * 2;
  const left = faceToCentroid(pair.left, frameW, frameH);
  const right = faceToCentroid(pair.right, frameW, frameH);
  const leftCrop = cropRectForCentroid(frameW, frameH, left.x, left.y, panelAspectRatio, headroom, left.extent);
  const rightCrop = cropRectForCentroid(frameW, frameH, right.x, right.y, panelAspectRatio, headroom, right.extent);
  return overlapFractionOfSmaller(
    { x: leftCrop.sx, y: leftCrop.sy, width: leftCrop.sw, height: leftCrop.sh },
    { x: rightCrop.sx, y: rightCrop.sy, width: rightCrop.sw, height: rightCrop.sh },
  ) <= MAX_COLLAGE_CROP_OVERLAP;
}

function closeEligibilityWindow(
  windows: CollageEligibilityWindow[],
  regionId: string,
  start: number | null,
  end: number,
): null {
  if (start != null && end >= start) windows.push({ regionId, start, end });
  return null;
}

/**
 * Builds stable, format-specific split windows. A two-face region remains the
 * persistent user-toggle unit; aspect windows only decide where that region
 * actually needs a collage.
 */
export function deriveCollageAspectEligibility(
  samples: FaceBoxSample[],
  regions: CollageRegion[],
  headroom: ClipperHeadroom,
): CollageAspectEligibility {
  const result: CollageAspectEligibility = { "16-9": [], "9-16": [], "1-1": [], "4-5": [] };

  for (const region of regions) {
    const regionSamples = samples.filter((sample) => sample.time >= region.start && sample.time <= region.end);
    for (const aspectId of Object.keys(COLLAGE_ASPECT_RATIOS) as ClipperAspectPresetId[]) {
      const ratio = COLLAGE_ASPECT_RATIOS[aspectId];
      let qualifyingRun = 0;
      let disqualifyingRun = 0;
      let openStart: number | null = null;

      for (let index = 0; index < regionSamples.length; index++) {
        const sample = regionSamples[index]!;
        const pair = selectDominantFacePair(sample.faces);
        const qualifies = pair != null
          && splitCropsAreDistinct(pair, sample.frameW, sample.frameH, ratio, headroom);

        if (qualifies) {
          qualifyingRun++;
          disqualifyingRun = 0;
        } else {
          disqualifyingRun++;
          qualifyingRun = 0;
        }

        if (openStart == null && qualifyingRun >= REGION_ENTER_SAMPLES) {
          openStart = regionSamples[Math.max(0, index - REGION_ENTER_SAMPLES + 1)]!.time;
        }
        if (openStart != null && disqualifyingRun >= REGION_EXIT_SAMPLES) {
          const closeIndex = Math.max(0, index - REGION_EXIT_SAMPLES + 1);
          openStart = closeEligibilityWindow(result[aspectId], region.id, openStart, regionSamples[closeIndex]!.time);
        }
      }
      if (openStart != null) closeEligibilityWindow(result[aspectId], region.id, openStart, region.end);
    }
  }

  return result;
}

export function isCollageAspectEligible(
  eligibility: CollageAspectEligibility,
  aspectId: ClipperAspectPresetId,
  regionId: string,
  time: number,
): boolean {
  return eligibility[aspectId].some((window) => window.regionId === regionId && time >= window.start && time <= window.end);
}

export function filterRegionsWithEligibleAspects(
  regions: CollageRegion[],
  eligibility: CollageAspectEligibility,
  aspectIds: ClipperAspectPresetId[],
): CollageRegion[] {
  const eligibleIds = new Set(
    aspectIds.flatMap((aspectId) => eligibility[aspectId].map((window) => window.regionId)),
  );
  return regions.filter((region) => eligibleIds.has(region.id));
}
