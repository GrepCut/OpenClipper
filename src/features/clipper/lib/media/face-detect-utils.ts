import type { FaceBox } from './face-detector';
import { boxIouXYWH } from './box-iou';

export const DETECT_MAX_SIDE = 320;

const MIN_FACE_PX = 20;
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 2.5;

export function filterFaceBoxes(faces: FaceBox[]): FaceBox[] {
  return faces.filter((f) => {
    if (f.width < MIN_FACE_PX || f.height < MIN_FACE_PX) return false;
    const aspect = f.width / f.height;
    return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
  });
}

export function faceIou(a: FaceBox, b: FaceBox): number {
  return boxIouXYWH(a, b);
}
