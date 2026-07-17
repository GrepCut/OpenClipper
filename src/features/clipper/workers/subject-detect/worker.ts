/// <reference lib="webworker" />

// MediaPipe's module WASM loader needs worker-specific DOM/import shims. Keep
// this before every MediaPipe import, matching the dedicated face worker.
import "../../../../shared/workers/mediapipe-worker-shim";

import * as tf from "@tensorflow/tfjs";
// alpha.10 exposes a broken modular entrypoint (missing generated client
// module). Its published FESM bundle is self-contained and is the supported
// compatibility path for this legacy peer-dependency installation.
import { loadTFLiteModel, setWasmPath } from "@tensorflow/tfjs-tflite/dist/tf-tflite.fesm.js";
import type { TFLiteModel } from "@tensorflow/tfjs-tflite/dist/tflite_model";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { getMediapipeWasmBaseUrl } from "../../../../shared/constants/mediapipe-wasm.constants";
import { modelAssetUrl } from "../../../../shared/models/model-url";
import { asset } from "../../../../shared/utils/asset";
import { boxIouXYXY } from "../../lib/media/box-iou";

type Request =
  | { id: number; type: "detect"; url: string; timestamp: number }
  | { id: number; type: "dispose" };

interface PixelDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  score: number;
}
interface PixelFaceDetection { x: number; y: number; width: number; height: number; keypoints: Array<{ x: number; y: number }> }

type Response =
  | { id: number; type: "result"; timestamp: number; width: number; height: number; detections: PixelDetection[]; autoflipFaces?: PixelFaceDetection[]; modelId?: string; degradedReason?: string; metrics?: { ssdInferenceMs: number; faceInferenceMs: number } }
  | { id: number; type: "error"; message: string };

const AUTOFLIP_MODEL_URL = modelAssetUrl("/models/autoflip_ssdlite/ssdlite_object_detection.tflite");
const AUTOFLIP_LABELS_URL = modelAssetUrl("/models/autoflip_ssdlite/ssdlite_object_detection_labelmap.txt");
const AUTOFLIP_MODEL_ID = "mediapipe-ssdlite-object-detection-320";
const FACE_MODEL_URL = modelAssetUrl("/models/blaze_face_full_range/blaze_face_full_range.tflite");
const AUTOFLIP_INPUT_SIZE = 320;
const AUTOFLIP_SCORE_THRESHOLD = 0.6;
const AUTOFLIP_NMS_IOU_THRESHOLD = 0.4;
const AUTOFLIP_MAX_DETECTIONS = 5;

interface Anchor { xCenter: number; yCenter: number; width: number; height: number }
interface RawDetection { ymin: number; xmin: number; ymax: number; xmax: number; labelIndex: number; score: number }

let detectorPromise: Promise<TFLiteModel> | null = null;
let labelsPromise: Promise<string[]> | null = null;
let faceDetectorPromise: Promise<FaceDetector> | null = null;

function getDetector(): Promise<TFLiteModel> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // The runtime files are emitted by vite.config.ts under stable names.
      // tfjs-tflite resolves the SIMD/threaded variant itself from this base.
      setWasmPath(asset("/assets/tflite/"));
      await tf.ready();
      return loadTFLiteModel(AUTOFLIP_MODEL_URL, { numThreads: 1 });
    })();
  }
  return detectorPromise;
}

function getLabels(): Promise<string[]> {
  if (!labelsPromise) {
    labelsPromise = fetch(AUTOFLIP_LABELS_URL).then(async (response) => {
      if (!response.ok) throw new Error(`Could not read AutoFlip label map (${response.status}).`);
      return (await response.text()).split(/\r?\n/).map((label) => label.trim());
    });
  }
  return labelsPromise;
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function generateAutoFlipAnchors(): Anchor[] {
  const anchors: Anchor[] = [];
  const strides = [16, 32, 64, 128, 256, 512];
  const aspectRatios = [1, 2, 0.5, 3, 0.3333];
  const scaleFor = (layer: number) => 0.2 + (0.95 - 0.2) * layer / (strides.length - 1);
  for (let layer = 0; layer < strides.length; layer += 1) {
    const scale = scaleFor(layer);
    const shapes = layer === 0
      ? [{ scale: 0.1, ratio: 1 }, { scale, ratio: 2 }, { scale, ratio: 0.5 }]
      : [...aspectRatios.map((ratio) => ({ scale, ratio })), {
        scale: Math.sqrt(scale * (layer === strides.length - 1 ? 1 : scaleFor(layer + 1))), ratio: 1,
      }];
    const featureMapSize = Math.ceil(AUTOFLIP_INPUT_SIZE / strides[layer]);
    for (let y = 0; y < featureMapSize; y += 1) {
      for (let x = 0; x < featureMapSize; x += 1) {
        for (const shape of shapes) {
          const sqrtRatio = Math.sqrt(shape.ratio);
          anchors.push({
            xCenter: (x + 0.5) / featureMapSize,
            yCenter: (y + 0.5) / featureMapSize,
            width: shape.scale * sqrtRatio,
            height: shape.scale / sqrtRatio,
          });
        }
      }
    }
  }
  if (anchors.length !== 2034) throw new Error(`AutoFlip anchor configuration produced ${anchors.length}, expected 2034.`);
  return anchors;
}

const AUTOFLIP_ANCHORS = generateAutoFlipAnchors();

function asTensors(output: ReturnType<TFLiteModel["predict"]>): tf.Tensor[] {
  if (output instanceof tf.Tensor) return [output];
  if (Array.isArray(output)) return output;
  return Object.values(output);
}

async function detectAutoFlipObjects(model: TFLiteModel, bitmap: ImageBitmap, labels: string[]): Promise<PixelDetection[]> {
  const input = tf.tidy(() => tf.image.resizeBilinear(tf.browser.fromPixels(bitmap, 3), [AUTOFLIP_INPUT_SIZE, AUTOFLIP_INPUT_SIZE]).expandDims(0));
  const tensors = asTensors(model.predict(input));
  input.dispose();
  try {
    const boxesTensor = tensors.find((tensor) => tensor.shape.at(-1) === 4);
    const scoresTensor = tensors.find((tensor) => tensor.shape.at(-1) === 91);
    if (!boxesTensor || !scoresTensor) throw new Error("AutoFlip SSD Lite returned unexpected output tensors.");
    const [boxes, scores] = await Promise.all([boxesTensor.data(), scoresTensor.data()]);
    const candidates: RawDetection[] = [];
    for (let index = 0; index < AUTOFLIP_ANCHORS.length; index += 1) {
      let labelIndex = 0;
      let score = 0;
      for (let classIndex = 1; classIndex < 91; classIndex += 1) {
        const classScore = sigmoid(scores[index * 91 + classIndex]);
        if (classScore > score) {
          score = classScore;
          labelIndex = classIndex;
        }
      }
      if (score < AUTOFLIP_SCORE_THRESHOLD) continue;
      const anchor = AUTOFLIP_ANCHORS[index];
      const offset = index * 4;
      const yCenter = boxes[offset] / 10 * anchor.height + anchor.yCenter;
      const xCenter = boxes[offset + 1] / 10 * anchor.width + anchor.xCenter;
      const height = Math.exp(boxes[offset + 2] / 5) * anchor.height;
      const width = Math.exp(boxes[offset + 3] / 5) * anchor.width;
      candidates.push({ ymin: yCenter - height / 2, xmin: xCenter - width / 2, ymax: yCenter + height / 2, xmax: xCenter + width / 2, labelIndex, score });
    }
    const selected: RawDetection[] = [];
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (selected.some((existing) => boxIouXYXY(candidate, existing) >= AUTOFLIP_NMS_IOU_THRESHOLD)) continue;
      selected.push(candidate);
      if (selected.length === AUTOFLIP_MAX_DETECTIONS) break;
    }
    return selected.map((detection) => {
      const x = Math.max(0, detection.xmin * bitmap.width);
      const y = Math.max(0, detection.ymin * bitmap.height);
      const right = Math.min(bitmap.width, detection.xmax * bitmap.width);
      const bottom = Math.min(bitmap.height, detection.ymax * bitmap.height);
      return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y), label: labels[detection.labelIndex] || `class-${detection.labelIndex}`, score: detection.score };
    }).filter((detection) => detection.width > 0 && detection.height > 0);
  } finally {
    tensors.forEach((tensor) => tensor.dispose());
  }
}

function getFaceDetector(): Promise<FaceDetector> {
  if (!faceDetectorPromise) {
    faceDetectorPromise = FilesetResolver.forVisionTasks(getMediapipeWasmBaseUrl(), true).then((vision) =>
      FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.6,
      }),
    );
  }
  return faceDetectorPromise;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "dispose") {
      detectorPromise = null;
      labelsPromise = null;
      const faceDetector = await faceDetectorPromise;
      faceDetector?.close();
      faceDetectorPromise = null;
      self.postMessage({ id: request.id, type: "result", timestamp: 0, width: 0, height: 0, detections: [] } satisfies Response);
      return;
    }
    const response = await fetch(request.url);
    if (!response.ok) throw new Error(`Could not read analysis frame (${response.status}).`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const [detector, labels, faceDetector] = await Promise.all([getDetector(), getLabels(), getFaceDetector()]);
      const ssdStarted = performance.now();
      const detections = await detectAutoFlipObjects(detector, bitmap, labels);
      const ssdInferenceMs = performance.now() - ssdStarted;
      const timestampMs = Math.round(request.timestamp * 1000);
      const faceStarted = performance.now();
      const faceResult = faceDetector.detectForVideo(bitmap, timestampMs);
      const faceInferenceMs = performance.now() - faceStarted;
      const autoflipFaces = faceResult.detections.flatMap<PixelFaceDetection>((detection) => {
        const box = detection.boundingBox;
        if (!box) return [];
        return [{ x: box.originX, y: box.originY, width: box.width, height: box.height,
          keypoints: (detection.keypoints ?? []).map((point) => ({ x: point.x * bitmap.width, y: point.y * bitmap.height })) }];
      });
      self.postMessage({ id: request.id, type: "result", timestamp: request.timestamp,
        width: bitmap.width, height: bitmap.height, detections, autoflipFaces, modelId: AUTOFLIP_MODEL_ID,
        metrics: { ssdInferenceMs, faceInferenceMs } } satisfies Response);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    self.postMessage({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) } satisfies Response);
  }
};

export {};
