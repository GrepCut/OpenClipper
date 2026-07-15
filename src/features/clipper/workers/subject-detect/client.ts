import { normalizeDetections } from "../../engine/smart-crop";
import type { SubjectDetectionSample } from "../../shared/smart-crop";
import { clipperLog } from "../../shared/logger";

interface WorkerResult {
  id: number;
  type: "result" | "error";
  timestamp?: number;
  width?: number;
  height?: number;
  detections?: Array<{ x: number; y: number; width: number; height: number; label: string; score: number }>;
  autoflipFaces?: Array<{ x: number; y: number; width: number; height: number; keypoints: Array<{ x: number; y: number }> }>;
  modelId?: string;
  degradedReason?: string;
  message?: string;
  metrics?: { ssdInferenceMs: number; faceInferenceMs: number };
}

export class SubjectDetectorWorkerClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private serial = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private maxPending = 0;
  private ssdInferenceMs = 0;
  private faceInferenceMs = 0;

  detect(url: string, timestamp: number): Promise<SubjectDetectionSample> {
    this.pending++;
    this.maxPending = Math.max(this.maxPending, this.pending);
    const task = this.chain.then(() => this.request(url, timestamp));
    this.chain = task.catch(() => {});
    return task.finally(() => { this.pending--; });
  }

  private request(url: string, timestamp: number): Promise<SubjectDetectionSample> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.id !== id) return;
        this.worker.removeEventListener("message", onMessage);
        if (event.data.type === "error") return reject(new Error(event.data.message ?? "Object detector failed."));
        this.ssdInferenceMs += event.data.metrics?.ssdInferenceMs ?? 0;
        this.faceInferenceMs += event.data.metrics?.faceInferenceMs ?? 0;
        const normalized = normalizeDetections(event.data.timestamp ?? timestamp, event.data.width ?? 1,
          event.data.height ?? 1, event.data.detections ?? []);
        resolve({
          ...normalized,
          autoflipFaces: (event.data.autoflipFaces ?? []).map((face) => ({
            box: { x: face.x / (event.data.width ?? 1), y: face.y / (event.data.height ?? 1), width: face.width / (event.data.width ?? 1), height: face.height / (event.data.height ?? 1) },
            keypoints: face.keypoints.map((point) => ({ x: point.x / (event.data.width ?? 1), y: point.y / (event.data.height ?? 1) })),
          })),
          modelId: event.data.modelId,
          degradedReason: event.data.degradedReason,
        });
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ id, type: "detect", url, timestamp });
    });
  }

  dispose(): void {
    clipperLog("subject analysis: legacy worker metrics", {
      ssdInferenceMs: Math.round(this.ssdInferenceMs),
      faceInferenceMs: Math.round(this.faceInferenceMs),
      maxPendingQueueDepth: this.maxPending,
    });
    this.worker.terminate();
  }
}
