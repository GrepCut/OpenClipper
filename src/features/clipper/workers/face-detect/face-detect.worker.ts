/// <reference lib="webworker" />

import "../../../../shared/workers/mediapipe-worker-shim";

/**
 * Detects faces over one `[startTime, endTime)` time-slice of the source
 * video: decodes via mediabunny and runs the same tiled MediaPipe detection
 * `clipper-reframe.ts` uses on the main thread, in its own isolated
 * `ToolFaceDetectorService` instance (own WASM graph, own GPU/CPU delegate).
 * The main thread (`clipper-reframe.ts`'s `prefillFaceSampleCache`) runs
 * several of these concurrently, one per time-slice, and merges the streamed
 * `sample` messages into the shared `FaceSampleCache` as they arrive.
 */
import { ToolFaceDetectorService, type FaceDetectorInitOptions } from "../../lib/media/face-detector";
import { resetLegacyFaceInferenceMetrics, snapshotLegacyFaceInferenceMetrics } from "../../lib/media/face-detect-tiled";
import { clipperLog } from "../../shared/logger";
import { DetectorUnavailableError, detectFaceSampleAt, detectFaceSegment } from "./segment";
import type {
  DetectFrameRequest,
  DetectFramesInitRequest,
  DetectSegmentRequest,
  FaceDetectWorkerRequest,
  FaceDetectWorkerResponse,
  SerializedDetectError,
} from "./worker-protocol";

const worker = self as DedicatedWorkerGlobalScope;
let activeJob: { id: number; controller: AbortController } | null = null;

/** Streaming-frames job state (native Tauri path) — frames are processed sequentially through `chain`. */
let frameJob: {
  id: number;
  detector: ToolFaceDetectorService;
  detectorOptions: FaceDetectorInitOptions;
  chain: Promise<void>;
  failed: boolean;
} | null = null;

function serializeError(error: unknown): SerializedDetectError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: "Face detection segment failed unexpectedly." };
}

function post(message: FaceDetectWorkerResponse): void {
  worker.postMessage(message);
}

async function detectSegment(message: DetectSegmentRequest): Promise<void> {
  const { jobId, file, startTime, endTime, intervalSec, detectorOptions } = message;
  const controller = new AbortController();
  activeJob = { id: jobId, controller };
  const detector = new ToolFaceDetectorService();
  resetLegacyFaceInferenceMetrics();
  let loggedDelegate = false;

  try {
    await detectFaceSegment({
      file,
      startTime,
      endTime,
      intervalSec,
      detector,
      detectorOptions,
      signal: controller.signal,
      onSample: (sample) => {
        if (!loggedDelegate) {
          loggedDelegate = true;
          clipperLog("face analysis — detect worker ready", {
            delegate: detector.getActiveDelegate(),
            startTime,
            endTime,
          });
        }
        post({ type: "sample", jobId, sample });
      },
      onProgress: (ratio) => post({ type: "progress", jobId, ratio }),
    });
    post({ type: "complete", jobId });
    clipperLog("face analysis — legacy worker inference metrics", snapshotLegacyFaceInferenceMetrics());
  } catch (error) {
    if (controller.signal.aborted) return; // cancelled — no response needed
    post({
      type: "failed",
      jobId,
      error: serializeError(error),
      fatal: error instanceof DetectorUnavailableError,
    });
  } finally {
    if (activeJob?.id === jobId) {
      activeJob = null;
    }
  }
}

function initFrameJob(message: DetectFramesInitRequest): void {
  resetLegacyFaceInferenceMetrics();
  frameJob = {
    id: message.jobId,
    detector: new ToolFaceDetectorService(),
    detectorOptions: message.detectorOptions,
    chain: Promise.resolve(),
    failed: false,
  };
}

function enqueueFrame(message: DetectFrameRequest): void {
  const job = frameJob;
  if (!job || job.id !== message.jobId || job.failed) return;
  job.chain = job.chain.then(async () => {
    if (job.failed) return;
    try {
      const response = await fetch(message.url);
      if (!response.ok) throw new Error(`frame fetch failed: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const frame = new VideoFrame(bitmap, {
        timestamp: Math.round(message.timestamp * 1_000_000),
      });
      const sample = await detectFaceSampleAt(message.timestamp, job.detector, job.detectorOptions, {
        frame,
        bitmap,
        rotationDegrees: 0,
        release: () => {
          frame.close();
          bitmap.close();
        },
      });
      post({ type: "sample", jobId: job.id, sample });
    } catch (error) {
      if (error instanceof DetectorUnavailableError) {
        job.failed = true;
        post({ type: "failed", jobId: job.id, error: serializeError(error), fatal: true });
        return;
      }
      // Transient per-frame failure (fetch/decode glitch) — skip and keep going.
    }
  });
}

function flushFrameJob(jobId: number): void {
  const job = frameJob;
  if (!job || job.id !== jobId) return;
  void job.chain.then(() => {
    if (!job.failed) post({ type: "complete", jobId: job.id });
    clipperLog("face analysis — legacy frame worker inference metrics", snapshotLegacyFaceInferenceMetrics());
    if (frameJob?.id === job.id) frameJob = null;
  });
}

worker.addEventListener("message", (event: MessageEvent<FaceDetectWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    if (activeJob?.id === message.jobId) {
      activeJob.controller.abort();
    }
    return;
  }

  if (message.type === "detect-frames-init") {
    initFrameJob(message);
    return;
  }
  if (message.type === "detect-frame") {
    enqueueFrame(message);
    return;
  }
  if (message.type === "detect-frames-flush") {
    flushFrameJob(message.jobId);
    return;
  }

  if (activeJob) {
    post({
      type: "failed",
      jobId: message.jobId,
      error: { name: "Error", message: "A detection segment is already running in this worker." },
      fatal: false,
    });
    return;
  }

  void detectSegment(message);
});
