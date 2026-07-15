import type { FaceDetectorInitOptions } from "../../lib/media/face-detector";
import type { FaceBoxSample } from "../../shared/face-samples";

export interface SerializedDetectError {
  name: string;
  message: string;
}

export interface FaceDetectWorker {
  postMessage(message: FaceDetectWorkerRequest): void;
  terminate(): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: EventListener): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: EventListener): void;
}

export interface DetectSegmentRequest {
  type: "detect-segment";
  jobId: number;
  file: File;
  startTime: number;
  endTime: number;
  intervalSec: number;
  detectorOptions: FaceDetectorInitOptions;
}

/**
 * Streaming mode used by the native (Tauri) extraction path: FFmpeg writes
 * sparse JPEG frames to disk and the main thread forwards their
 * `grepcut-media://` URLs here as they arrive. The worker fetches + decodes +
 * detects each frame off the main thread and streams `sample` responses back.
 */
export interface DetectFramesInitRequest {
  type: "detect-frames-init";
  jobId: number;
  detectorOptions: FaceDetectorInitOptions;
}

export interface DetectFrameRequest {
  type: "detect-frame";
  jobId: number;
  /** grepcut-media URL of the JPEG frame written by Rust. */
  url: string;
  /** Seconds, relative to the clip range (same domain as FaceBoxSample.time). */
  timestamp: number;
}

/** Asks the worker to finish its queued frames and reply `complete`. */
export interface DetectFramesFlushRequest {
  type: "detect-frames-flush";
  jobId: number;
}

export type FaceDetectWorkerRequest =
  | DetectSegmentRequest
  | DetectFramesInitRequest
  | DetectFrameRequest
  | DetectFramesFlushRequest
  | { type: "cancel"; jobId: number };

export type FaceDetectWorkerResponse =
  | { type: "progress"; jobId: number; ratio: number }
  | { type: "sample"; jobId: number; sample: FaceBoxSample }
  | { type: "complete"; jobId: number }
  | { type: "failed"; jobId: number; error: SerializedDetectError; fatal: boolean }
  | { type: "unavailable"; jobId: number };
