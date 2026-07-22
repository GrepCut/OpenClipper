import { clamp } from "../../lib/math";
import type { FaceBox } from "../../shared/face-samples";
import type { NormalizedBox } from "../../shared/smart-crop";
import type { ClipperHeadroom } from "../../settings/settings";

export interface ClipperCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface FaceCentroid {
  x: number;
  y: number;
  extent: number;
}

const HEADROOM_ZOOM_FACTOR: Record<ClipperHeadroom, number> = {
  tight: 2.4,
  normal: 3.6,
  wide: 5.2,
};

const MIN_ZOOM_SCALE = 0.28;

function naturalCoverCrop(srcW: number, srcH: number, targetRatio: number): { sw: number; sh: number } {
  const srcRatio = srcW / srcH;
  if (srcRatio > targetRatio) {
    return { sw: srcH * targetRatio, sh: srcH };
  }
  return { sw: srcW, sh: srcW / targetRatio };
}

export function faceToCentroid(face: FaceBox, frameW: number, frameH: number): FaceCentroid {
  const x = (face.x + face.width / 2) / frameW;
  const y = (face.y + face.height / 2) / frameH;
  const diag = Math.hypot(face.width, face.height);
  const frameDiag = Math.hypot(frameW, frameH);
  const extent = frameDiag > 0 ? diag / frameDiag : 0;
  return { x, y, extent };
}

export function cropRectForCentroid(
  srcW: number,
  srcH: number,
  cx: number,
  cy: number,
  targetRatio: number,
  headroom: ClipperHeadroom,
  extent?: number,
): ClipperCropRect {
  const { sw: naturalSw, sh: naturalSh } = naturalCoverCrop(srcW, srcH, targetRatio);
  let sw = naturalSw;
  let sh = naturalSh;

  if (extent != null && extent > 0) {
    const frameDiagonal = Math.hypot(srcW, srcH);
    const naturalDiagonal = Math.hypot(naturalSw, naturalSh);
    const desiredDiagonal = extent * frameDiagonal * HEADROOM_ZOOM_FACTOR[headroom];
    const scale = naturalDiagonal > 0 ? clamp(desiredDiagonal / naturalDiagonal, MIN_ZOOM_SCALE, 1) : 1;
    sw = naturalSw * scale;
    sh = naturalSh * scale;
  }

  const sx = clamp(cx * srcW - sw / 2, 0, Math.max(0, srcW - sw));
  const sy = clamp(cy * srcH - sh / 2, 0, Math.max(0, srcH - sh));
  return { sx, sy, sw, sh };
}

export function normalizedBoxToCropRect(
  box: NormalizedBox,
  source: { width: number; height: number },
): ClipperCropRect {
  return {
    sx: box.x * source.width,
    sy: box.y * source.height,
    sw: box.width * source.width,
    sh: box.height * source.height,
  };
}
