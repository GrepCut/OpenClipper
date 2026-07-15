import type { SubjectDetectionSample } from "../shared/smart-crop";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function normalizeDetections(
  time: number,
  width: number,
  height: number,
  detections: Array<{ x: number; y: number; width: number; height: number; label: string; score: number }>,
): SubjectDetectionSample {
  return {
    time,
    detections: detections.map((detection) => ({
      label: detection.label,
      score: detection.score,
      box: {
        x: clamp01(detection.x / width),
        y: clamp01(detection.y / height),
        width: clamp01(detection.width / width),
        height: clamp01(detection.height / height),
      },
    })),
  };
}
