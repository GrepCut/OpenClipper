import type { FaceDetectorInitOptions } from "../../lib/media/face-detector";
import type {
  DetectSegmentRequest,
  FaceDetectWorker,
  FaceDetectWorkerResponse,
} from "./worker-protocol";
import type { FaceBoxSample } from "../../shared/face-samples";
import { createFaceDetectWorker, FaceDetectWorkerUnavailableError } from "./worker-factory";

export { FaceDetectWorkerUnavailableError };

function toError(error: { name: string; message: string }, fatal: boolean): Error {
  const result = new Error(error.message) as Error & { fatal?: boolean };
  result.name = error.name;
  result.fatal = fatal;
  return result;
}

export interface DetectFaceSegmentWorkerOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  onSample?: (sample: FaceBoxSample) => void;
}

/**
 * Detects faces over one `[startTime, endTime)` segment in a dedicated
 * one-shot worker; resolves once the whole segment has been scanned. Streams
 * `FaceBoxSample`s to `onSample` as they're found rather than batching them,
 * so the caller can merge them into its cache incrementally. Rejects with an
 * Error whose `.fatal` property is `true` only for a broken detector setup
 * (mirrors `DetectorUnavailableError` from the main-thread path) — every
 * other failure is a per-sample skip handled inside the worker already.
 */
export function detectFaceSegmentWithWorker(
  file: File,
  startTime: number,
  endTime: number,
  intervalSec: number,
  detectorOptions: FaceDetectorInitOptions,
  options: DetectFaceSegmentWorkerOptions = {},
  createDetectWorker: () => FaceDetectWorker = createFaceDetectWorker,
): Promise<void> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException("Conversion aborted", "AbortError"));
  }

  let worker: FaceDetectWorker;
  try {
    worker = createDetectWorker();
  } catch (error) {
    return Promise.reject(
      error instanceof FaceDetectWorkerUnavailableError ? error : new FaceDetectWorkerUnavailableError(),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const jobId = 1;
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      worker.terminate();
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      worker.postMessage({ type: "cancel", jobId });
      settle(() => reject(new DOMException("Conversion aborted", "AbortError")));
    };

    const onMessage = (event: Event) => {
      const message = (event as MessageEvent<FaceDetectWorkerResponse>).data;
      if (!message || message.jobId !== jobId) return;

      switch (message.type) {
        case "progress":
          options.onProgress?.(message.ratio);
          return;
        case "sample":
          options.onSample?.(message.sample);
          return;
        case "complete":
          settle(resolve);
          return;
        case "failed":
          settle(() => reject(toError(message.error, message.fatal)));
          return;
        case "unavailable":
          settle(() => reject(new FaceDetectWorkerUnavailableError()));
          return;
      }
    };

    const onWorkerError = () => {
      settle(() => reject(new FaceDetectWorkerUnavailableError()));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerError);
    worker.addEventListener("messageerror", onWorkerError);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const request: DetectSegmentRequest = {
      type: "detect-segment",
      jobId,
      file,
      startTime,
      endTime,
      intervalSec,
      detectorOptions,
    };
    worker.postMessage(request);
  });
}
