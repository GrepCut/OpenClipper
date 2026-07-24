import type { FaceBoxSample } from "../../shared/face-samples.util";
import type { AutoFlipFaceDetection, NormalizedBox, SubjectDetectionSample } from "../../shared/smart-crop.util";

/** A cached face observation is useful only for the detector frame nearest to it. */
const MAX_FACE_CACHE_DELTA_SEC = 0.25;
const DUPLICATE_FACE_OVERLAP = 0.5;
const EPSILON = 1e-9;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeFace(face: FaceBoxSample["faces"][number], sample: FaceBoxSample): AutoFlipFaceDetection | null {
  if (sample.frameW <= 0 || sample.frameH <= 0 || face.width <= 0 || face.height <= 0) return null;
  const x = clamp01(face.x / sample.frameW);
  const y = clamp01(face.y / sample.frameH);
  const right = clamp01((face.x + face.width) / sample.frameW);
  const bottom = clamp01((face.y + face.height) / sample.frameH);
  if (right <= x || bottom <= y) return null;
  return { box: { x, y, width: right - x, height: bottom - y }, keypoints: [] };
}

function overlapFractionOfSmaller(a: NormalizedBox, b: NormalizedBox): number {
  const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 ? (overlapWidth * overlapHeight) / smallerArea : 0;
}

function boxCenter(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function unionBoxes(a: NormalizedBox, b: NormalizedBox): NormalizedBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function matchingNativeFaceIndex(nativeFaces: AutoFlipFaceDetection[], cached: AutoFlipFaceDetection): number {
  const cachedCenter = boxCenter(cached.box);
  return nativeFaces
    .map((native, index) => {
      const nativeCenter = boxCenter(native.box);
      const dx = Math.abs(nativeCenter.x - cachedCenter.x);
      const dy = Math.abs(nativeCenter.y - cachedCenter.y);
      const overlaps = overlapFractionOfSmaller(cached.box, native.box) >= DUPLICATE_FACE_OVERLAP;
      const centerCompatible = dx <= Math.max(0.025, cached.box.width * 0.4)
        && dy <= Math.max(0.025, cached.box.height * 0.4);
      return { index, distance: Math.hypot(dx, dy), compatible: overlaps && centerCompatible };
    })
    .filter((candidate) => candidate.compatible)
    .sort((left, right) => left.distance - right.distance)[0]?.index ?? -1;
}

function crossesSceneCut(from: number, to: number, sceneCuts: readonly number[]): boolean {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return sceneCuts.some((cut) => cut > start + EPSILON && cut <= end + EPSILON);
}

function nearestFaceSample(
  faceSamples: readonly FaceBoxSample[],
  time: number,
  sceneCuts: readonly number[],
): FaceBoxSample | null {
  let closest: FaceBoxSample | null = null;
  let closestDelta = MAX_FACE_CACHE_DELTA_SEC + EPSILON;
  for (const sample of faceSamples) {
    const delta = Math.abs(sample.time - time);
    if (delta > closestDelta || crossesSceneCut(sample.time, time, sceneCuts)) continue;
    if (delta < closestDelta) {
      closest = sample;
      closestDelta = delta;
    }
  }
  return closest;
}

/**
 * The WinML pass returns two views of the same SCRFD result: landmark-rich
 * subject samples and a persisted, full-range face cache.  A sparse subject
 * sample may lose its face payload while the cache still has the observation.
 * Restore only that local evidence; never interpolate or hold it across a cut.
 */
export function attachFaceCacheEvidence(
  detections: readonly SubjectDetectionSample[],
  faceSamples: readonly FaceBoxSample[],
  sceneCuts: readonly number[],
): SubjectDetectionSample[] {
  if (!detections.length || !faceSamples.length) return [...detections];
  const sortedFaces = [...faceSamples].sort((left, right) => left.time - right.time);
  return detections.map((sample) => {
    const cached = nearestFaceSample(sortedFaces, sample.time, sceneCuts);
    if (!cached?.faces.length) return sample;
    const nativeFaces = (sample.autoflipFaces ?? []).map((face) => ({ ...face, box: { ...face.box } }));
    const cachedFaces = cached.faces
      .map((face) => normalizeFace(face, cached))
      .filter((face): face is AutoFlipFaceDetection => face != null);
    if (!cachedFaces.length) return sample;
    const merged = [...nativeFaces];
    for (const cachedFace of cachedFaces) {
      const nativeIndex = matchingNativeFaceIndex(merged, cachedFace);
      if (nativeIndex < 0) {
        merged.push(cachedFace);
        continue;
      }
      const native = merged[nativeIndex]!;
      // The native landmark payload supplies identity and precise focus; the
      // persisted SCRFD rectangle supplies the complete visible face extent.
      // Enrich the same observation instead of dropping the larger rectangle
      // as a duplicate.
      merged[nativeIndex] = { ...native, box: unionBoxes(native.box, cachedFace.box) };
    }
    return { ...sample, autoflipFaces: merged };
  });
}
