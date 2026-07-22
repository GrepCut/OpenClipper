import type { FaceBox, FaceBoxSample } from "../../shared/face-samples";
import type { ClipperFacePickStrategy, ClipperSmoothingStrength } from "../../settings/settings";
import { faceToCentroid } from "./crop";
import type { CentroidSample, FaceCentroid } from "../types/reframe";

/** Lower alpha = slower/smoother EMA response to new detections. */
export const SMOOTHING_ALPHA: Record<ClipperSmoothingStrength, number> = {
  smooth: 0.12,
  balanced: 0.28,
  snappy: 0.85,
};

export function pickPrimaryFace(
  faces: FaceBox[],
  frameW: number,
  frameH: number,
  strategy: ClipperFacePickStrategy,
): FaceBox | null {
  if (faces.length === 0) return null;
  if (strategy === "largest") {
    return faces.reduce((best, f) => (f.width * f.height > best.width * best.height ? f : best));
  }
  const cx = frameW / 2;
  const cy = frameH / 2;
  return faces.reduce((best, f) => {
    const bestDist = Math.hypot(best.x + best.width / 2 - cx, best.y + best.height / 2 - cy);
    const fDist = Math.hypot(f.x + f.width / 2 - cx, f.y + f.height / 2 - cy);
    return fDist < bestDist ? f : best;
  });
}

export function blendCentroid(prev: FaceCentroid, next: FaceCentroid, alpha: number): FaceCentroid {
  return {
    x: alpha * next.x + (1 - alpha) * prev.x,
    y: alpha * next.y + (1 - alpha) * prev.y,
    extent: alpha * next.extent + (1 - alpha) * prev.extent,
  };
}

/** Reduces whole-clip face samples to a single smoothed focus track (Face Follow mode). */
export function deriveSingleFocusTrack(
  samples: FaceBoxSample[],
  strategy: ClipperFacePickStrategy,
  smoothing: ClipperSmoothingStrength,
): CentroidSample[] {
  const alpha = SMOOTHING_ALPHA[smoothing];
  const track: CentroidSample[] = [];
  let prev: FaceCentroid | null = null;

  for (const sample of samples) {
    const face = pickPrimaryFace(sample.faces, sample.frameW, sample.frameH, strategy);
    if (!face) {
      if (prev) track.push({ t: sample.time, ...prev });
      continue;
    }
    const centroid = faceToCentroid(face, sample.frameW, sample.frameH);
    const previous: FaceCentroid | null = prev;
    prev = sample.sceneCut || previous === null ? centroid : blendCentroid(previous, centroid, alpha);
    track.push({ t: sample.time, ...prev, cut: sample.sceneCut });
  }

  return track;
}

const FALLBACK_CENTROID: CentroidSample = { t: 0, x: 0.5, y: 0.5, extent: 0 };

function centroidValue(sample: CentroidSample): FaceCentroid {
  return { x: sample.x, y: sample.y, extent: sample.extent };
}

export function interpolateCentroid(
  samples: CentroidSample[],
  t: number,
): { x: number; y: number; extent: number } {
  if (samples.length === 0) return centroidValue(FALLBACK_CENTROID);
  if (t <= samples[0].t) return centroidValue(samples[0]);
  const last = samples[samples.length - 1];
  if (t >= last.t) return centroidValue(last);

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (t >= a.t && t <= b.t) {
      if (b.cut) return t >= b.t ? b : a;
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        extent: a.extent + (b.extent - a.extent) * f,
      };
    }
  }
  return last;
}
