import type { AutoFlipFaceDetection, SubjectDetection, SubjectDetectionSample } from "../../shared/smart-crop";
import type { KeyFrameSalientInput, SalientRegion, SalientSignalType } from "./types";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** AutoFlip's PacketThinnerCalculator emits an analysis frame every 200 ms. */
export const AUTOFLIP_KEYFRAME_INTERVAL_SEC = 0.2;
/** Allow one decoded source-frame of timestamp jitter, but never borrow a neighbouring 5 FPS sample. */
const MAX_KEYFRAME_SAMPLE_DELTA_SEC = 0.1;

const SIGNAL_WEIGHTS: Record<SalientSignalType, { minScore: number; maxScore: number; required: boolean }> = {
  face_core: { minScore: 0.85, maxScore: 0.9, required: false },
  face_all: { minScore: 0.8, maxScore: 0.85, required: false },
  face_full: { minScore: 0.8, maxScore: 0.85, required: false },
  human: { minScore: 0.75, maxScore: 0.8, required: false },
  pet: { minScore: 0.7, maxScore: 0.75, required: false },
  car: { minScore: 0.7, maxScore: 0.75, required: false },
  object: { minScore: 0.1, maxScore: 0.2, required: false },
};

const PET_LABELS = new Set(["cat", "dog", "bird", "horse"]);
const CAR_LABELS = new Set(["car", "truck"]);

function mapDetectionLabel(label: string): SalientSignalType {
  const normalized = label.toLowerCase();
  if (normalized === "person") return "human";
  if (PET_LABELS.has(normalized)) return "pet";
  if (CAR_LABELS.has(normalized)) return "car";
  return "object";
}

function weightedScore(rawScore: number, signalType: SalientSignalType): number {
  const weights = SIGNAL_WEIGHTS[signalType];
  const clamped = clamp01(rawScore);
  return weights.minScore + clamped * (weights.maxScore - weights.minScore);
}

function faceRegionsFromDetection(face: AutoFlipFaceDetection): SalientRegion[] {
  // FaceToRegionCalculator uses the first four landmarks for the core signal
  // and all six for the broader face signal. VisualScorer defaults to area.
  const points = face.keypoints.length >= 4 ? face.keypoints : [];
  const boxFrom = (items: Array<{ x: number; y: number }>) => {
    if (!items.length) return face.box;
    const xs = items.map((point) => point.x);
    const ys = items.map((point) => point.y);
    const x = Math.max(0, Math.min(...xs));
    const y = Math.max(0, Math.min(...ys));
    return { x, y, width: Math.min(1, Math.max(...xs)) - x, height: Math.min(1, Math.max(...ys)) - y };
  };
  const core = boxFrom(points.slice(0, 4));
  const all = boxFrom(points.slice(0, 6));
  return [
    // VisualScorer's default is area-only and it evaluates each emitted
    // landmark rectangle independently.
    { box: core, score: weightedScore(clamp01(core.width * core.height), "face_core"), signalType: "face_core", isRequired: false },
    { box: all, score: weightedScore(clamp01(all.width * all.height), "face_all"), signalType: "face_all", isRequired: false },
  ];
}

function regionsFromDetections(detections: SubjectDetection[]): SalientRegion[] {
  return detections.flatMap((detection) => {
    const signalType = mapDetectionLabel(detection.label);
    const specific: SalientRegion = {
      box: detection.box,
      // LocalizationToRegionCalculator sets raw score to one, independent of
      // the detector confidence that already passed the graph threshold.
      score: weightedScore(1, signalType),
      signalType,
      // The reference AutoFlip graph marks every configured signal optional.
      isRequired: false,
    };
    // LocalizationToRegionCalculator(output_all_signals: true) emits both the
    // class-specific signal and the low-priority generic object signal.
    return signalType === "object"
      ? [specific]
      : [specific, { ...specific, score: weightedScore(1, "object"), signalType: "object" }];
  });
}

/** Where a head sits inside a person detection box, when no face detector confirmed one. */
const HEAD_BAND_WIDTH_FRACTION = 0.6;
const HEAD_BAND_HEIGHT_FRACTION = 0.22;
const HEAD_MIN_DETECTION_SCORE = 0.5;

function boxesIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

/**
 * Face detectors miss profile and partially occluded faces that the person
 * detector still tracks.  Estimate a head band from each confident person box
 * that no detected face overlaps, and emit it on the otherwise unused
 * `face_full` signal — inside the face priority band, but always below a real
 * face detection.
 */
export function syntheticHeadRegions(
  detections: SubjectDetection[],
  faces: AutoFlipFaceDetection[],
): SalientRegion[] {
  const regions: SalientRegion[] = [];
  for (const detection of detections) {
    if (mapDetectionLabel(detection.label) !== "human") continue;
    if (detection.predicted || detection.score < HEAD_MIN_DETECTION_SCORE) continue;
    const box = detection.box;
    const head = {
      x: box.x + (box.width * (1 - HEAD_BAND_WIDTH_FRACTION)) / 2,
      y: box.y,
      width: box.width * HEAD_BAND_WIDTH_FRACTION,
      height: box.height * HEAD_BAND_HEIGHT_FRACTION,
    };
    if (head.width <= 0 || head.height <= 0) continue;
    if (faces.some((face) => boxesIntersect(head, face.box))) continue;
    regions.push({ box: head, score: weightedScore(0.5, "face_full"), signalType: "face_full", isRequired: false });
  }
  return regions;
}

function nearest<T extends { time: number }>(items: T[], time: number, maxDelta: number): T | null {
  let best: T | null = null;
  let delta = maxDelta;
  for (const item of items) {
    const distance = Math.abs(item.time - time);
    if (distance < delta) {
      best = item;
      delta = distance;
    }
  }
  return best;
}

export interface BuildSalientKeyframesInput {
  detections: SubjectDetectionSample[];
  sceneCuts: number[];
  clipStart: number;
  clipEnd: number;
  keyframeIntervalSec?: number;
}

export function buildSalientKeyframes(input: BuildSalientKeyframesInput): KeyFrameSalientInput[] {
  const interval = input.keyframeIntervalSec ?? AUTOFLIP_KEYFRAME_INTERVAL_SEC;
  const keyframes: KeyFrameSalientInput[] = [];
  for (let time = input.clipStart; time <= input.clipEnd + 1e-9; time += interval) {
    const detectionSample = nearest(input.detections, time, Math.min(interval / 2, MAX_KEYFRAME_SAMPLE_DELTA_SEC));
    const regions = [
      ...regionsFromDetections(detectionSample?.detections ?? []),
      ...(detectionSample?.autoflipFaces ?? []).flatMap(faceRegionsFromDetection),
      ...syntheticHeadRegions(detectionSample?.detections ?? [], detectionSample?.autoflipFaces ?? []),
    ];
    const isShotChange = input.sceneCuts.some((cut) => Math.abs(cut - time) <= interval * 0.6);
    keyframes.push({ time, regions, isShotChange });
  }
  return keyframes;
}

export { mapDetectionLabel, weightedScore, SIGNAL_WEIGHTS };
