import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { getMediapipeWasmBaseUrl } from "../../../../shared/constants/mediapipe-wasm.constants";
import { modelAssetUrl } from "../../../../shared/models/model-url";

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FaceDetectorModel = "short" | "full";

/** Clockwise rotation applied via MediaPipe ImageProcessingOptions. */
export type FaceRotationDegrees = 0 | 90 | 180 | 270;

export type FaceDetectorDelegate = "CPU" | "GPU";

export interface FaceDetectorInitOptions {
  model?: FaceDetectorModel;
  minDetectionConfidence?: number;
  runningMode?: "IMAGE" | "VIDEO";
  delegate?: FaceDetectorDelegate;
}

const MODEL_URLS: Record<FaceDetectorModel, string> = {
  short: modelAssetUrl("/models/blaze_face_short_range/blaze_face_short_range.tflite"),
  full: modelAssetUrl("/models/blaze_face_full_range/blaze_face_full_range.tflite"),
};

const BOX_PAD = 0.08;
const DEFAULT_MIN_DETECTION_CONFIDENCE = 0.65;
const DEFAULT_RUNNING_MODE: "IMAGE" | "VIDEO" = "IMAGE";

let cachedGpuDelegateAvailable: boolean | null = null;

/**
 * Module workers cannot load MediaPipe's classic UMD WASM loader with
 * `importScripts()`. The ES-module loader publishes the ModuleFactory that
 * the existing worker shim and MediaPipe task bundle expect instead.
 */
function shouldUseModuleWasmRuntime(): boolean {
  return typeof (globalThis as typeof globalThis & { importScripts?: unknown }).importScripts === "function";
}

async function probeGpuDelegate(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  model: FaceDetectorModel,
): Promise<boolean> {
  if (cachedGpuDelegateAvailable !== null) return cachedGpuDelegateAvailable;
  try {
    const probe = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URLS[model],
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    });
    probe.close();
    cachedGpuDelegateAvailable = true;
    return true;
  } catch {
    cachedGpuDelegateAvailable = false;
    return false;
  }
}

export class ToolFaceDetectorService {
  private static instance: ToolFaceDetectorService | null = null;
  private detector: FaceDetector | null = null;
  private initPromise: Promise<void> | null = null;
  private model: FaceDetectorModel = "full";
  private minDetectionConfidence = DEFAULT_MIN_DETECTION_CONFIDENCE;
  private configuredRunningMode: "IMAGE" | "VIDEO" = DEFAULT_RUNNING_MODE;
  private configuredDelegate: FaceDetectorDelegate = "CPU";
  private activeDelegate: FaceDetectorDelegate = "CPU";
  private runningMode: "IMAGE" | "VIDEO" = DEFAULT_RUNNING_MODE;
  private lastVideoTimestampMs = -1;
  private detectChain: Promise<unknown> = Promise.resolve();

  public static getInstance(): ToolFaceDetectorService {
    if (!ToolFaceDetectorService.instance) {
      ToolFaceDetectorService.instance = new ToolFaceDetectorService();
    }
    return ToolFaceDetectorService.instance;
  }

  public warm(options: FaceDetectorInitOptions = {}): void {
    void this.initialize(options).catch(() => {});
  }

  /** Destroys the WASM graph and re-inits for a new video job. */
  public async prepareSession(options: FaceDetectorInitOptions = {}): Promise<void> {
    this.lastVideoTimestampMs = -1;
    this.detector?.close();
    this.detector = null;
    this.initPromise = null;
    await this.initialize(options);
  }

  /** @deprecated Use prepareSession — kept for callers that relied on the old name. */
  public async beginVideoSession(options: FaceDetectorInitOptions = {}): Promise<void> {
    return this.prepareSession(options);
  }

  public initialize(options: FaceDetectorInitOptions = {}): Promise<void> {
    const model = options.model ?? this.model;
    const minConf = options.minDetectionConfidence ?? this.minDetectionConfidence;
    const mode = options.runningMode ?? this.configuredRunningMode;
    const requestedDelegate = options.delegate ?? this.configuredDelegate;
    if (
      this.detector &&
      this.model === model &&
      this.minDetectionConfidence === minConf &&
      this.configuredRunningMode === mode &&
      this.configuredDelegate === requestedDelegate
    ) {
      return Promise.resolve();
    }

    this.model = model;
    this.minDetectionConfidence = minConf;
    this.configuredRunningMode = mode;
    this.configuredDelegate = requestedDelegate;
    this.detector = null;
    this.initPromise = null;

    this.initPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        getMediapipeWasmBaseUrl(),
        shouldUseModuleWasmRuntime(),
      );
      let delegate: FaceDetectorDelegate = "CPU";
      if (requestedDelegate === "GPU") {
        delegate = (await probeGpuDelegate(vision, model)) ? "GPU" : "CPU";
      }
      this.activeDelegate = delegate;

      try {
        this.detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URLS[model],
            delegate,
          },
          runningMode: mode,
          minDetectionConfidence: minConf,
          minSuppressionThreshold: 0.4,
        });
        this.runningMode = mode;
      } catch (error) {
        if (delegate === "GPU") {
          cachedGpuDelegateAvailable = false;
          this.activeDelegate = "CPU";
          this.detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_URLS[model],
              delegate: "CPU",
            },
            runningMode: mode,
            minDetectionConfidence: minConf,
            minSuppressionThreshold: 0.4,
          });
          this.runningMode = mode;
          return;
        }
        throw error;
      }
    })();

    return this.initPromise;
  }

  public getActiveDelegate(): FaceDetectorDelegate {
    return this.activeDelegate;
  }

  private runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.detectChain.then(fn, fn);
    this.detectChain = next.catch(() => {});
    return next;
  }

  private allocateVideoTimestampMs(timestampSec: number): number {
    const frameMs = Math.round(timestampSec * 1000);
    const ts = Math.max(frameMs, this.lastVideoTimestampMs + 1);
    this.lastVideoTimestampMs = ts;
    return ts;
  }

  private async setRunningMode(mode: "IMAGE" | "VIDEO"): Promise<void> {
    if (!this.detector || this.runningMode === mode) return;
    await this.detector.setOptions({ runningMode: mode });
    this.runningMode = mode;
  }

  private mapDetections(
    detections: ReturnType<FaceDetector["detect"]>["detections"],
    w: number,
    h: number,
  ): FaceBox[] {
    return detections
      .map((det) => {
        const box = det.boundingBox;
        if (!box) return null;
        const score = det.categories?.[0]?.score ?? 0;
        if (score < this.minDetectionConfidence) return null;
        const px = Math.max(0, box.originX - box.width * BOX_PAD);
        const py = Math.max(0, box.originY - box.height * BOX_PAD);
        const pw = Math.min(w - px, box.width * (1 + BOX_PAD * 2));
        const ph = Math.min(h - py, box.height * (1 + BOX_PAD * 2));
        return { x: px, y: py, width: pw, height: ph };
      })
      .filter((b): b is FaceBox => b !== null);
  }

  public async detectImage(
    bitmap: ImageBitmap,
    rotationDegrees: FaceRotationDegrees = 0,
  ): Promise<FaceBox[]> {
    return this.runExclusive(async () => {
      await this.initialize();
      if (!this.detector) {
        throw new Error("Face detector not initialized.");
      }

      const result = this.detector.detect(bitmap, { rotationDegrees });
      return this.mapDetections(result.detections, bitmap.width, bitmap.height);
    });
  }

  public async detectVideo(
    bitmap: ImageBitmap,
    timestampSec: number,
    rotationDegrees: FaceRotationDegrees = 0,
  ): Promise<FaceBox[]> {
    return this.runExclusive(async () => {
      await this.initialize();
      if (!this.detector) {
        throw new Error("Face detector not initialized.");
      }

      await this.setRunningMode("VIDEO");
      const timestampMs = this.allocateVideoTimestampMs(timestampSec);
      const result = this.detector.detectForVideo(bitmap, timestampMs, { rotationDegrees });
      return this.mapDetections(result.detections, bitmap.width, bitmap.height);
    });
  }
}
