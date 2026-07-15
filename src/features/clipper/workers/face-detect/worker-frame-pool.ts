import type { FaceDetectorInitOptions } from "../../lib/media/face-detector";
import type { FaceBoxSample } from "../../shared/face-samples";
import { DetectorUnavailableError } from "./segment";
import { FaceDetectWorkerUnavailableError } from "./worker-client";
import type { FaceDetectWorker, FaceDetectWorkerResponse } from "./worker-protocol";
import { createFaceDetectWorker } from "./worker-factory";

export interface NativeFrameRef {
  url: string;
  timestamp: number;
}

export interface FaceDetectFramePoolOptions {
  onSample: (sample: FaceBoxSample) => void;
  signal?: AbortSignal;
}

/**
 * Pula workerów dla natywnej (Tauri) ścieżki analizy twarzy: klatki JPEG
 * wyekstrahowane przez FFmpeg spływają strumieniowo (`submit`), a fetch +
 * dekodowanie + MediaPipe odbywają się w workerach (round-robin), nie na
 * głównym wątku. `drain()` domyka strumień i czeka na dokończenie kolejek.
 *
 * Fatalny błąd detektora w którymkolwiek workerze (zepsuty setup WASM/modelu)
 * odrzuca `drain()` z `DetectorUnavailableError` — pojedyncze złe klatki są
 * pomijane wewnątrz workera.
 */
export class FaceDetectFramePool {
  private workers: FaceDetectWorker[] = [];
  private next = 0;
  private fatalError: Error | null = null;
  private completions: Promise<void>[] = [];
  private disposed = false;
  private static nextJobId = 1;
  private readonly jobId: number;

  constructor(
    workerCount: number,
    detectorOptions: FaceDetectorInitOptions,
    private readonly options: FaceDetectFramePoolOptions,
  ) {
    this.jobId = FaceDetectFramePool.nextJobId++;
    const count = Math.max(1, workerCount);
    for (let i = 0; i < count; i++) {
      const worker = createFaceDetectWorker();
      this.completions.push(this.attach(worker));
      worker.postMessage({ type: "detect-frames-init", jobId: this.jobId, detectorOptions });
      this.workers.push(worker);
    }
  }

  /** Kolejkuje klatkę do detekcji (round-robin). Ciche no-op po błędzie fatalnym/dispose. */
  submit(frame: NativeFrameRef): void {
    if (this.disposed || this.fatalError || this.options.signal?.aborted) return;
    const worker = this.workers[this.next % this.workers.length];
    this.next++;
    worker.postMessage({
      type: "detect-frame",
      jobId: this.jobId,
      url: frame.url,
      timestamp: frame.timestamp,
    });
  }

  /**
   * Domknięcie strumienia: każe workerom dokończyć kolejki i czeka na wszystkie.
   * Zawsze terminuje workery (także przy błędzie). Odrzuca przy fatalnym błędzie
   * detektora lub abortcie.
   */
  async drain(): Promise<void> {
    try {
      for (const worker of this.workers) {
        worker.postMessage({ type: "detect-frames-flush", jobId: this.jobId });
      }
      await Promise.all(this.completions);
      if (this.options.signal?.aborted) {
        throw new DOMException("Conversion aborted", "AbortError");
      }
      if (this.fatalError) throw this.fatalError;
    } finally {
      this.dispose();
    }
  }

  /** Natychmiast terminuje workery — do sprzątania przy przerwaniu. Idempotentne. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
  }

  private attach(worker: FaceDetectWorker): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const onMessage = (event: Event) => {
        const message = (event as MessageEvent<FaceDetectWorkerResponse>).data;
        if (!message || message.jobId !== this.jobId) return;
        switch (message.type) {
          case "sample":
            if (!this.fatalError && !this.options.signal?.aborted) {
              this.options.onSample(message.sample);
            }
            return;
          case "complete":
            settle();
            return;
          case "failed":
            if (message.fatal && !this.fatalError) {
              this.fatalError = new DetectorUnavailableError(message.error.message);
            }
            settle();
            return;
          default:
            return;
        }
      };

      const onWorkerError = () => {
        if (!this.fatalError) {
          this.fatalError = new FaceDetectWorkerUnavailableError();
        }
        settle();
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onWorkerError);

      const onAbort = () => settle();
      this.options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
