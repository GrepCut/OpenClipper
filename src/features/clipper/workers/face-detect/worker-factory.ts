import type { FaceDetectWorker } from "./worker-protocol";

export class FaceDetectWorkerUnavailableError extends Error {
  constructor(message = "This browser cannot run parallel face detection in a background worker.") {
    super(message);
    this.name = "FaceDetectWorkerUnavailableError";
  }
}

export function createFaceDetectWorker(): FaceDetectWorker {
  if (typeof Worker === "undefined") {
    throw new FaceDetectWorkerUnavailableError();
  }
  return new Worker(new URL("./face-detect.worker.ts", import.meta.url), {
    type: "module",
  });
}
