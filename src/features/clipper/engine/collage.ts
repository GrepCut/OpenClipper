import { evenInt } from "../lib/media/video-draw";
import type { ClipperSmoothingStrength } from "../settings/settings";
import {
  blendCentroid,
  type CentroidSample,
  cropRectForCentroid,
  FACE_SAMPLE_INTERVAL_SEC,
  faceToCentroid,
  type FaceBoxSample,
  type FaceCentroid,
  interpolateCentroid,
  pickPrimaryFace,
  SMOOTHING_ALPHA,
} from "./reframe";
import type { ClipperHeadroom } from "../settings/settings";
import type { FrameEffectSize } from "../lib/media/video-frame-effect";

export interface CollageTracks {
  top: CentroidSample[];
  bottom: CentroidSample[];
  hasTwoSpeakers: boolean;
}

/** A contiguous time window where two speakers were stably detected side by side. */
export interface CollageRegion {
  id: string;
  start: number;
  end: number;
  /** true = the left half of frame is the dominant (top) speaker for this region's whole span. */
  topIsLeft: boolean;
}

/** Consecutive qualifying/disqualifying samples required to open/close a region — ~1.5s at the 0.5s sample interval, so a single stray misdetection can't flicker a region in or out. */
const REGION_HYSTERESIS_SAMPLES = 3;

/**
 * Splits whole-clip face samples into two independently-tracked speaker
 * regions by horizontal frame position (left-of-center -> top half, right ->
 * bottom half). `hasTwoSpeakers` only goes true once both sides show a real,
 * sustained presence — a single stray misdetection on one side isn't enough.
 */
export function deriveCollageTracks(
  samples: FaceBoxSample[],
  smoothing: ClipperSmoothingStrength,
): CollageTracks {
  const alpha = SMOOTHING_ALPHA[smoothing];
  const top: CentroidSample[] = [];
  const bottom: CentroidSample[] = [];
  let prevTop: FaceCentroid | null = null;
  let prevBottom: FaceCentroid | null = null;
  let leftCount = 0;
  let rightCount = 0;
  let samplesWithFaces = 0;

  for (const sample of samples) {
    if (sample.faces.length === 0) continue;
    samplesWithFaces++;

    const midX = sample.frameW / 2;
    const leftFaces = sample.faces.filter((f) => f.x + f.width / 2 < midX);
    const rightFaces = sample.faces.filter((f) => f.x + f.width / 2 >= midX);

    const leftFace = pickPrimaryFace(leftFaces, sample.frameW, sample.frameH, "largest");
    const rightFace = pickPrimaryFace(rightFaces, sample.frameW, sample.frameH, "largest");

    if (leftFace) {
      leftCount++;
      const centroid = faceToCentroid(leftFace, sample.frameW, sample.frameH);
      prevTop = sample.sceneCut || !prevTop ? centroid : blendCentroid(prevTop, centroid, alpha);
    }
    if (prevTop) top.push({ t: sample.time, ...prevTop, cut: sample.sceneCut });

    if (rightFace) {
      rightCount++;
      const centroid = faceToCentroid(rightFace, sample.frameW, sample.frameH);
      prevBottom = sample.sceneCut || !prevBottom ? centroid : blendCentroid(prevBottom, centroid, alpha);
    }
    if (prevBottom) bottom.push({ t: sample.time, ...prevBottom, cut: sample.sceneCut });
  }

  const threshold = Math.max(3, Math.round(samplesWithFaces * 0.15));
  const hasTwoSpeakers = leftCount >= threshold && rightCount >= threshold;

  return { top, bottom, hasTwoSpeakers };
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
    const midX = sample.frameW / 2;
    const leftFaces = sample.faces.filter((f) => f.x + f.width / 2 < midX);
    const rightFaces = sample.faces.filter((f) => f.x + f.width / 2 >= midX);
    const leftFace = pickPrimaryFace(leftFaces, sample.frameW, sample.frameH, "largest");
    const rightFace = pickPrimaryFace(rightFaces, sample.frameW, sample.frameH, "largest");
    const bothPresent = !!leftFace && !!rightFace;

    if (bothPresent) {
      qualifyingRun++;
      disqualifyingRun = 0;
    } else {
      disqualifyingRun++;
      qualifyingRun = 0;
    }

    if (openStart == null && qualifyingRun >= REGION_HYSTERESIS_SAMPLES) {
      const openIndex = Math.max(0, i - REGION_HYSTERESIS_SAMPLES + 1);
      openStart = samples[openIndex]!.time;
    }

    if (openStart != null) {
      if (leftFace) leftScore += faceToCentroid(leftFace, sample.frameW, sample.frameH).extent;
      if (rightFace) rightScore += faceToCentroid(rightFace, sample.frameW, sample.frameH).extent;

      if (disqualifyingRun >= REGION_HYSTERESIS_SAMPLES) {
        const closeIndex = Math.max(0, i - REGION_HYSTERESIS_SAMPLES + 1);
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
  smoothing: ClipperSmoothingStrength,
  regions: CollageRegion[],
  disabledRegionIds: string[],
): CollageTracks {
  const alpha = SMOOTHING_ALPHA[smoothing];
  const top: CentroidSample[] = [];
  const bottom: CentroidSample[] = [];
  const disabled = new Set(disabledRegionIds);
  const enabledRegions = regions.filter((r) => !disabled.has(r.id));

  let regionIndex = 0;
  let prevTop: FaceCentroid | null = null;
  let prevBottom: FaceCentroid | null = null;

  for (const sample of samples) {
    while (regionIndex < enabledRegions.length && sample.time > enabledRegions[regionIndex]!.end) {
      regionIndex++;
      prevTop = null;
      prevBottom = null;
    }
    const region = enabledRegions[regionIndex];
    if (!region || sample.time < region.start || sample.faces.length === 0) continue;

    const midX = sample.frameW / 2;
    const leftFaces = sample.faces.filter((f) => f.x + f.width / 2 < midX);
    const rightFaces = sample.faces.filter((f) => f.x + f.width / 2 >= midX);
    const leftFace = pickPrimaryFace(leftFaces, sample.frameW, sample.frameH, "largest");
    const rightFace = pickPrimaryFace(rightFaces, sample.frameW, sample.frameH, "largest");
    const topFace = region.topIsLeft ? leftFace : rightFace;
    const bottomFace = region.topIsLeft ? rightFace : leftFace;

    if (topFace) {
      const centroid = faceToCentroid(topFace, sample.frameW, sample.frameH);
      prevTop = sample.sceneCut || !prevTop ? centroid : blendCentroid(prevTop, centroid, alpha);
    }
    if (prevTop) top.push({ t: sample.time, ...prevTop, cut: sample.sceneCut });

    if (bottomFace) {
      const centroid = faceToCentroid(bottomFace, sample.frameW, sample.frameH);
      prevBottom = sample.sceneCut || !prevBottom ? centroid : blendCentroid(prevBottom, centroid, alpha);
    }
    if (prevBottom) bottom.push({ t: sample.time, ...prevBottom, cut: sample.sceneCut });
  }

  return { top, bottom, hasTwoSpeakers: enabledRegions.length > 0 };
}

const COLLAGE_DIVIDER_PX = 3;

/**
 * Draws a top/bottom podcast collage: each half independently cover-crops the
 * source around its own tracked speaker. Only meaningful for "crop" formats —
 * callers should keep "pad" (landscape/contain) formats on the normal path.
 */
export function drawPodcastCollageFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  tracks: CollageTracks,
  t: number,
  headroom: ClipperHeadroom,
  showDivider: boolean,
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);

  const halfH = evenInt(output.height / 2);
  const bottomH = output.height - halfH;
  const targetRatio = output.width / halfH;

  const topCentroid = interpolateCentroid(tracks.top, t);
  const bottomCentroid = interpolateCentroid(tracks.bottom, t);

  const topCrop = cropRectForCentroid(
    source.width,
    source.height,
    topCentroid.x,
    topCentroid.y,
    targetRatio,
    headroom,
    topCentroid.extent,
  );
  const bottomCrop = cropRectForCentroid(
    source.width,
    source.height,
    bottomCentroid.x,
    bottomCentroid.y,
    output.width / bottomH,
    headroom,
    bottomCentroid.extent,
  );

  ctx.drawImage(frame, topCrop.sx, topCrop.sy, topCrop.sw, topCrop.sh, 0, 0, output.width, halfH);
  ctx.drawImage(
    frame,
    bottomCrop.sx,
    bottomCrop.sy,
    bottomCrop.sw,
    bottomCrop.sh,
    0,
    halfH,
    output.width,
    bottomH,
  );

  if (showDivider) {
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(0, halfH - COLLAGE_DIVIDER_PX / 2, output.width, COLLAGE_DIVIDER_PX);
  }
}
