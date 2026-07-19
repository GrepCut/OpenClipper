import type { ClipperFaceSamplesBlob, FaceBoxSample } from "../shared/face-samples";
import type { AutoFlipStaticFeatureSample } from "../shared/smart-crop";
import { createMediabunnyInput } from "../lib/media/mediabunny-file-source";
import { type FaceBox, ToolFaceDetectorService } from "../lib/media/face-detector";
import { MAX_WORKERS } from "../lib/media/parallel-workers";
import type { ClipperFacePickStrategy, ClipperHeadroom, ClipperSmoothingStrength } from "../settings/settings";
import { clipperLog, clipperWarn, formatBytes } from "../shared/logger";
import {
  DetectorUnavailableError,
  detectFaceSampleAt,
  detectFaceSegment,
  type FaceDetectFrameSource,
} from "../workers/face-detect/segment";
import { detectFaceSegmentWithWorker } from "../workers/face-detect/worker-client";
import { FaceDetectFramePool } from "../workers/face-detect/worker-frame-pool";
import {
  createTauriNativeJobId,
  runTauriNativeJob,
} from "../../../shared/utils/tauri-native-jobs";

export type { FaceBoxSample, FaceDetectFrameSource };
export { DetectorUnavailableError };

/** Sample every 0.5s to keep whole-clip face analysis fast, while still providing a stable focus track. */
export const FACE_SAMPLE_INTERVAL_SEC = 0.5;

/** Below this duration, spinning up parallel workers (each loading its own WASM/model) costs more than it saves. */
const MIN_DURATION_FOR_PARALLEL_DETECT_SEC = 15;

export const CLIPPER_FACE_DETECTOR_OPTIONS = {
  model: "full" as const,
  minDetectionConfidence: 0.55,
  runningMode: "IMAGE" as const,
  delegate: "GPU" as const,
};

export function hasAnyFaces(samples: FaceBoxSample[]): boolean {
  return samples.some((s) => s.faces.length > 0);
}

/**
 * Bucket key for coalescing "the same instant" across preview scrub time,
 * render frame PTS, and concurrent per-format render passes onto one cache
 * slot. A 0.5s bucket coalesces preview and render requests around each
 * precomputed sample, avoiding redundant detector work.
 */
export function faceBucketKey(time: number, intervalSec: number = FACE_SAMPLE_INTERVAL_SEC): number {
  return Math.round(time / intervalSec);
}

/**
 * Per-session cache of raw per-bucket face detections, filled lazily on
 * demand from whichever call site (live preview or render) visits a given
 * timestamp first. Owns in-flight dedup so concurrent callers (live preview
 * + N concurrently-rendering formats) racing to the same new bucket trigger
 * exactly one `detectFacesTiled` call, not one each.
 */
export class FaceSampleCache {
  private samples = new Map<number, FaceBoxSample>();
  private inFlight = new Map<number, Promise<FaceBoxSample | null>>();
  private sortedCache: FaceBoxSample[] | null = null;
  private revision = 0;
  private fatal = false;
  readonly intervalSec: number;
  analysisEngine: "winml" | "wasm" = "wasm";
  analysisModelVersion = "mediapipe-blaze-face-full-range";

  constructor(
    intervalSec: number = FACE_SAMPLE_INTERVAL_SEC,
    private onSampleResolved?: () => void,
  ) {
    this.intervalSec = intervalSec;
  }

  hasBucket(time: number): boolean {
    return this.samples.has(faceBucketKey(time, this.intervalSec));
  }

  /** Monotonic counter bumped on ingest — lets callers invalidate derived track caches. */
  get sampleRevision(): number {
    return this.revision;
  }

  /** Ascending by time — cached until the next ingest. */
  sortedSamples(): FaceBoxSample[] {
    if (this.sortedCache) return this.sortedCache;
    this.sortedCache = [...this.samples.values()].sort((a, b) => a.time - b.time);
    return this.sortedCache;
  }

  private invalidateSortedCache(): void {
    this.sortedCache = null;
    this.revision++;
  }

  /**
   * Ensures a sample exists for `time`'s bucket, detecting on miss. Dedups
   * concurrent requests for the same bucket. `makeSource` is only invoked on
   * an actual miss with nothing in flight — treat it as expensive/lazy.
   */
  async ensure(
    time: number,
    detector: ToolFaceDetectorService,
    makeSource: () => Promise<FaceDetectFrameSource>,
  ): Promise<void> {
    if (this.fatal) return;
    const key = faceBucketKey(time, this.intervalSec);
    if (this.samples.has(key)) return;
    const pending = this.inFlight.get(key);
    if (pending) {
      await pending;
      return;
    }

    const promise = (async () => {
      try {
        const source = await makeSource();
        const sample = await detectFaceSampleAt(time, detector, CLIPPER_FACE_DETECTOR_OPTIONS, source);
        this.samples.set(key, sample);
        this.invalidateSortedCache();
        this.onSampleResolved?.();
        return sample;
      } catch (error) {
        if (error instanceof DetectorUnavailableError) this.fatal = true;
        return null; // leave bucket unset — a future ensure() call will retry (unless now fatal)
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    await promise;
  }

  /** Inserts an already-computed sample (e.g. from a parallel detection worker) without invoking the detector. */
  ingest(sample: FaceBoxSample): void {
    if (this.fatal) return;
    const key = faceBucketKey(sample.time, this.intervalSec);
    if (this.samples.has(key)) return;
    this.samples.set(key, sample);
    this.invalidateSortedCache();
    this.onSampleResolved?.();
  }

  /** Restores many precomputed samples with a single cache invalidation. */
  bulkIngest(samples: FaceBoxSample[]): void {
    if (this.fatal) return;
    let added = false;
    for (const sample of samples) {
      const key = faceBucketKey(sample.time, this.intervalSec);
      if (this.samples.has(key)) continue;
      this.samples.set(key, sample);
      added = true;
    }
    if (added) {
      this.invalidateSortedCache();
      this.onSampleResolved?.();
    }
  }

  /** Flags the bucket nearest `time` as a hard cut — used once cut analysis (which needs the whole clip) completes after samples were already ingested. */
  markSceneCut(time: number): void {
    const key = faceBucketKey(time, this.intervalSec);
    const sample = this.samples.get(key);
    if (!sample) return;
    sample.sceneCut = true;
    this.invalidateSortedCache();
  }

  /** Permanently stops future detection attempts — matches `ensure()`'s existing fatal short-circuit, so on-demand callers (live preview, render fallback) also stop retrying after a broken detector setup. */
  markFatal(): void {
    this.fatal = true;
  }
}

export function hydrateFaceSampleCache(
  cache: FaceSampleCache,
  blob: ClipperFaceSamplesBlob,
): void {
  cache.analysisEngine = blob.engine ?? "wasm";
  cache.analysisModelVersion = blob.modelVersion ?? "mediapipe-blaze-face-full-range";
  cache.bulkIngest(blob.samples);
}

export function getClipperDetectorVersion(): string {
  const options = CLIPPER_FACE_DETECTOR_OPTIONS;
  // policy3: 10 fps scene histograms, fast H.264 decode, reusable preprocessing buffers
  return `mediapipe-${options.model}-${options.minDetectionConfidence}+cut1+native-clipper-vision-v1-policy3`;
}

export function serializeFaceSampleCache(
  cache: FaceSampleCache,
  clipStart: number,
  clipEnd: number,
): ClipperFaceSamplesBlob {
  return {
    detectorVersion: getClipperDetectorVersion(),
    engine: cache.analysisEngine,
    modelVersion: cache.analysisModelVersion,
    clipStart,
    clipEnd,
    samples: cache.sortedSamples(),
  };
}

export interface PrefillFaceSampleCacheOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  onPhase?: (message: string) => void;
  /** Canonical native phase id for benchmark timing (initializing, decoding, keyframes, …). */
  onNativePhase?: (phase: string) => void;
  /** Smoothed seconds-remaining estimate from the native extractor; only fires on the native path. */
  onEta?: (etaSeconds: number | null) => void;
  intervalSec?: number;
  /** Native Tauri source range. When present, FFmpeg extracts the sparse frames in one decode pass. */
  nativeSource?: { filePath: string; startTime: number; endTime: number };
  /**
   * When set (native path only), the same decode pass also samples
   * subject/motion frames at native-side cadence instead of a second,
   * independent full decode — see `NativeMediaExtractionSummary.subject`.
   */
  subjectExtraction?: {
    /** AutoFlip scales its feature stream to this width without upscaling. */
    targetWidth: number;
    onSubjectFrame: (frame: NativeMediaSubjectFrame, timestampSec: number) => void;
  };
}

interface NativeMediaFaceFrame {
  timestamp: number;
  width: number;
  height: number;
  /** grepcut-media URL of the JPEG written to disk by Rust (no base64 over IPC). */
  frameUrl: string;
}

export interface NativeMediaSubjectFrame {
  timestamp: number;
  width: number;
  height: number;
  frameUrl: string;
}

interface NativeMediaProgress {
  phase: "keyframes" | "gap-fill" | "analyzing" | "complete";
  processedFrames: number;
  expectedFrames: number;
  percent: number;
  timestampSec: number;
  etaSeconds: number | null;
  faceFrame: NativeMediaFaceFrame | null;
  subjectFrame: NativeMediaSubjectFrame | null;
}

export interface NativeMediaExtractionSummary {
  engine?: "legacy";
  /** Passed back to `cleanup_clipper_frames` to delete the on-disk frame files. */
  jobId: string;
  face: { frameCount: number; encodedBytes: number; width: number; height: number };
  /** `null` when `subjectExtraction` wasn't requested — no subject decode pass ran. */
  subject: { frameCount: number; encodedBytes: number; width: number; height: number } | null;
  /** Timestamps (relative to the clip range, same domain as sample.time) where a hard cut was detected. */
  sceneCutTimestamps: number[];
  /** Presentation timestamp of every decoded video frame in clip-relative seconds. */
  frameTimestamps: number[];
  /** Average decoded video rate used by AutoFlip's frame-counted scene limit. */
  sourceFrameRate: number;
  hasSolidColorBackground: boolean;
  solidBackgroundColor: { r: number; g: number; b: number } | null;
  staticFeatureSamples: AutoFlipStaticFeatureSample[];
  /** Stable source-space image area after native AutoFlip border analysis. */
  contentRect: { x: number; y: number; width: number; height: number };
}

export type NativeVisionDevice = "directx-high-performance" | "cpu";

export interface NativeVisionMetrics {
  decodeDurationMs: number;
  inferenceDurationMs: number;
  drainDurationMs: number;
  faceInferenceMs: number;
  objectInferenceMs: number;
  poseInferenceMs: number;
  baseFacePasses: number;
  recoveryFacePasses: number;
  orientationProbePasses: number;
  peakFaceQueueDepth: number;
  peakObjectQueueDepth: number;
  encodedJpegBytes: number;
  trackerDurationMs: number;
  trackedSubjectCount: number;
  predictedSubjectCount: number;
  recoveryTriggers: number;
  yoloxInvocations: number;
  acceptedRecoveries: number;
  rejectedRecoveryDuplicates: number;
  rejectedRecoveryCandidates: number;
  acceptedPredictedIou: number;
  acceptedPoseSupport: number;
  acceptedFaceSupport: number;
  acceptedTemporalPersistence: number;
  yoloxInferenceMs: number;
  codecDecodeApiMs: number;
  histogramMs: number;
  sampleScaleMs: number;
  frameCopyRotateMs: number;
  borderAnalysisMs: number;
  queueWaitMs: number;
  facePreprocessMs: number;
  objectPreprocessMs: number;
  posePreprocessMs: number;
  decodedFrameCount: number;
  histogramSampleCount: number;
  decodeThreadCount: number;
  fastDecodeEnabled: boolean;
}

interface NativeVisionProgress {
  phase: "initializing" | "decoding" | "inferencing" | "draining" | "complete";
  percent: number;
  timestampSec: number;
  etaSeconds: number | null;
  queuedDetections: number;
  faceSample?: FaceBoxSample;
  subjectSample?: import("../shared/smart-crop").SubjectDetectionSample;
}

interface NativeVisionCommandSummary {
  engine: "winml";
  faceDevice: NativeVisionDevice;
  objectDevice: NativeVisionDevice;
  poseDevice: NativeVisionDevice;
  frameWidth: number;
  frameHeight: number;
  faceSampleCount: number;
  subjectSampleCount: number;
  sceneCutTimestamps: number[];
  frameTimestamps: number[];
  sourceFrameRate: number;
  hasSolidColorBackground: boolean;
  solidBackgroundColor: { r: number; g: number; b: number } | null;
  staticFeatureSamples: AutoFlipStaticFeatureSample[];
  contentRect: { x: number; y: number; width: number; height: number };
  modelVersion: string;
  trackerVersion?: "bytetrack-v1";
  metrics: NativeVisionMetrics;
}

export interface NativeVisionAnalysisSummary extends NativeVisionCommandSummary {
  subjectSamples: import("../shared/smart-crop").SubjectDetectionSample[];
}

export type ClipperNativeAnalysisSummary = NativeMediaExtractionSummary | NativeVisionAnalysisSummary;

interface NativeVisionCapability {
  available: boolean;
  modelVersion: string | null;
  reasonCode: string | null;
  reason: string | null;
}

let nativeVisionProbe: Promise<NativeVisionCapability> | null = null;

function clipperWinMlVisionEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const override = window.localStorage?.getItem("clipperWinMlVision");
  if (override === "false" || override === "0") return false;
  if (override === "true" || override === "1") return true;
  // Acceptance gates have not yet been recorded for this corpus. Release
  // builds opt in explicitly; supported Windows alone is not sufficient.
  return import.meta.env.VITE_CLIPPER_WINML_VISION === "true";
}

function clipperByteTrackTrackingMode(): "bytetrack-v1" | "off" {
  if (typeof window === "undefined") return "bytetrack-v1";
  const override = window.localStorage?.getItem("clipperByteTrack");
  return override === "false" || override === "0" || override === "off" ? "off" : "bytetrack-v1";
}

type ClipperObjectDetectorMode = "ssd" | "yolox-recovery" | "yolox-shadow" | "yolox-primary";

function normalizeObjectDetectorMode(value: string | null | undefined): ClipperObjectDetectorMode | null {
  return value === "ssd" || value === "yolox-recovery" || value === "yolox-shadow" || value === "yolox-primary"
    ? value
    : null;
}

function clipperObjectDetectorMode(): ClipperObjectDetectorMode {
  const configured = normalizeObjectDetectorMode(import.meta.env.VITE_CLIPPER_OBJECT_DETECTOR_MODE)
    ?? "yolox-recovery";
  if (typeof window === "undefined") return configured;
  return normalizeObjectDetectorMode(window.localStorage?.getItem("clipperObjectDetectorMode")) ?? configured;
}

async function probeNativeVision(): Promise<NativeVisionCapability> {
  if (!nativeVisionProbe) {
    nativeVisionProbe = import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<NativeVisionCapability>("probe_clipper_winml"))
      .catch((error) => ({ available: false, modelVersion: null, reasonCode: "probe_failed", reason: String(error) }));
  }
  return nativeVisionProbe;
}

async function detectWinMlMedia(
  source: NonNullable<PrefillFaceSampleCacheOptions["nativeSource"]>,
  cache: FaceSampleCache,
  signal?: AbortSignal,
  onProgress?: (ratio: number) => void,
  onPhase?: (message: string) => void,
  onEta?: (etaSeconds: number | null) => void,
  onNativePhase?: (phase: string) => void,
): Promise<NativeVisionAnalysisSummary> {
  if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
  const faceSamples: FaceBoxSample[] = [];
  const subjectSamples: import("../shared/smart-crop").SubjectDetectionSample[] = [];
  let lastNativePhase: string | null = null;
  const onNativeProgress = (progress: NativeVisionProgress) => {
    if (progress.faceSample) faceSamples.push(progress.faceSample);
    if (progress.subjectSample) subjectSamples.push(progress.subjectSample);
    onProgress?.(Math.max(0, Math.min(1, progress.percent / 100)));
    onEta?.(progress.etaSeconds);
    if (progress.phase !== lastNativePhase) {
      lastNativePhase = progress.phase;
      onNativePhase?.(progress.phase);
    }
    if (progress.phase === "initializing") onPhase?.("Initializing native vision (WinML)…");
    else if (progress.phase === "decoding") onPhase?.("Decoding video and analyzing action…");
    else if (progress.phase === "draining") onPhase?.(`FFmpeg complete — finishing ${progress.queuedDetections} queued detections…`);
    else if (progress.phase === "inferencing") onPhase?.(`Analyzing faces and action… ${progress.percent}%`);
  };
  onPhase?.("Initializing native vision (WinML)…");
  const started = performance.now();
  const jobId = createTauriNativeJobId("winml");
  const summary = await runTauriNativeJob<NativeVisionProgress, NativeVisionCommandSummary>({
    jobId,
    startCommand: "start_clipper_winml_analysis",
    args: {
      filePath: source.filePath,
      startTime: source.startTime,
      endTime: source.endTime,
      trackingMode: clipperByteTrackTrackingMode(),
      objectDetectorMode: clipperObjectDetectorMode(),
    },
    signal,
    onProgress: onNativeProgress,
  });
  if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
  if (faceSamples.length !== summary.faceSampleCount || subjectSamples.length !== summary.subjectSampleCount) {
    throw new Error(`Native vision returned an incomplete atomic result (${faceSamples.length}/${summary.faceSampleCount} face, ${subjectSamples.length}/${summary.subjectSampleCount} subject).`);
  }
  cache.analysisEngine = "winml";
  cache.analysisModelVersion = summary.modelVersion;
  cache.bulkIngest(faceSamples);
  clipperLog("face analysis: WinML pipeline completed", {
    durationSec: Math.round((performance.now() - started) / 100) / 10,
    faceDevice: summary.faceDevice,
    objectDevice: summary.objectDevice,
    poseDevice: summary.poseDevice,
    faceSampleCount: faceSamples.length,
    subjectSampleCount: subjectSamples.length,
    metrics: summary.metrics,
    trackerVersion: summary.trackerVersion ?? null,
  });
  onProgress?.(1);
  onEta?.(0);
  return { ...summary, subjectSamples };
}

/**
 * Runs the unified `extract_clipper_media` native command: one ffmpeg decode
 * pass yields face-candidate frames and, when `subjectExtraction` is passed,
 * subject/motion samples too — instead of opening two independent decode
 * sessions over the same footage. Face frames are queued for detection as
 * they stream in exactly as before; subject frames are handed to the
 * caller's `onSubjectFrame` the same way, so the subjects pipeline stage can
 * queue its own ML detection while the (now shared) decode is still running.
 *
 * Cleanup: when subject extraction was requested, this function does NOT
 * delete the job's on-disk frames — the subject detector's `detect()` calls
 * fetch those JPEGs asynchronously and may still be in flight after this
 * resolves, so the caller must clean up (`cleanup_clipper_frames`) once its
 * own subject detection tasks have settled. Without subject extraction, this
 * cleans up itself, matching the previous face-only behavior.
 */
async function detectNativeMedia(
  source: NonNullable<PrefillFaceSampleCacheOptions["nativeSource"]>,
  intervalSec: number,
  cache: FaceSampleCache,
  detector: ToolFaceDetectorService,
  signal?: AbortSignal,
  onProgress?: (ratio: number) => void,
  onPhase?: (message: string) => void,
  onEta?: (etaSeconds: number | null) => void,
  subjectExtraction?: PrefillFaceSampleCacheOptions["subjectExtraction"],
  onNativePhase?: (phase: string) => void,
): Promise<NativeMediaExtractionSummary> {
  const { invoke } = await import("@tauri-apps/api/core");
  const extractionStarted = performance.now();
  onPhase?.(
    subjectExtraction
      ? "Decoding video and starting face + subject detection…"
      : "Scanning I-frames and starting face detection…",
  );
  onProgress?.(0);
  clipperLog("face analysis: native extraction started", {
    clipStartSec: source.startTime,
    clipEndSec: source.endTime,
    includeMotion: Boolean(subjectExtraction),
    faceMaxDimension: 960,
  });

  let receivedFrames = 0;
  let detectedFrames = 0;

  // Preferowana ścieżka: pula workerów — fetch + dekodowanie + MediaPipe poza
  // głównym wątkiem, równolegle. Fallback (brak Worker): sekwencyjnie na
  // głównym wątku jak dawniej, ale przez fetch(frameUrl) zamiast atob(base64).
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1;
  const workerCount = Math.max(1, Math.min(MAX_WORKERS, cores));
  let pool: FaceDetectFramePool | null = null;
  if (typeof Worker !== "undefined") {
    try {
      pool = new FaceDetectFramePool(workerCount, CLIPPER_FACE_DETECTOR_OPTIONS, {
        signal,
        onSample: (sample) => {
          cache.ingest(sample);
          detectedFrames++;
        },
      });
    } catch {
      pool = null;
    }
  }
  if (!pool) {
    onNativePhase?.("detector-init");
    const detectorStarted = performance.now();
    await detector.prepareSession(CLIPPER_FACE_DETECTOR_OPTIONS);
    onNativePhase?.("hybrid-extraction");
    clipperLog("face analysis: detector initialized", {
      durationSec: Math.round((performance.now() - detectorStarted) / 100) / 10,
      delegate: detector.getActiveDelegate(),
    });
  } else {
    onNativePhase?.("hybrid-extraction");
  }

  let detectionChain: Promise<void> = Promise.resolve();
  const detectStreamedFrameOnMainThread = async (item: NativeMediaFaceFrame) => {
    if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
    const response = await fetch(item.frameUrl);
    if (!response.ok) return;
    const bitmap = await createImageBitmap(await response.blob());
    const frame = new VideoFrame(bitmap, { timestamp: Math.round(item.timestamp * 1_000_000) });
    try {
      const sample = await detectFaceSampleAt(item.timestamp, detector, CLIPPER_FACE_DETECTOR_OPTIONS, {
        frame,
        bitmap,
        rotationDegrees: 0,
        release: () => { frame.close(); bitmap.close(); },
      });
      cache.ingest(sample);
    } catch (error) {
      if (error instanceof DetectorUnavailableError) throw error;
    }
    detectedFrames++;
  };

  let receivedSubjectFrames = 0;
  let summary: NativeMediaExtractionSummary | null = null;
  let completed = false;
  let lastNativePhase: string | null = null;
  try {
    const onNativeProgress = (progress: NativeMediaProgress) => {
      const nativePhase =
        progress.phase === "complete" && receivedFrames > detectedFrames
          ? "face-worker-drain"
          : progress.phase;
      if (nativePhase !== lastNativePhase) {
        lastNativePhase = nativePhase;
        onNativePhase?.(nativePhase);
      }
      if (progress.faceFrame) {
        receivedFrames++;
        if (pool) {
          pool.submit({ url: progress.faceFrame.frameUrl, timestamp: progress.faceFrame.timestamp });
        } else {
          detectionChain = detectionChain.then(() => detectStreamedFrameOnMainThread(progress.faceFrame!));
        }
      }
      if (progress.subjectFrame) {
        receivedSubjectFrames++;
        subjectExtraction?.onSubjectFrame(progress.subjectFrame, progress.subjectFrame.timestamp);
      }
      onEta?.(progress.etaSeconds);
      if (progress.phase === "keyframes") {
        const ratio = progress.percent / 100;
        onProgress?.(ratio);
        onPhase?.(`Scanning I-frames… ${progress.percent}% (${receivedFrames} found, ${detectedFrames} detected)`);
      } else if (progress.phase === "gap-fill") {
        const ratio = progress.percent / 100;
        onProgress?.(ratio);
        onPhase?.(`Filling frame gaps… ${progress.percent}% (${progress.processedFrames}/${progress.expectedFrames}, ${detectedFrames} detected)`);
      } else if (progress.phase === "analyzing") {
        const ratio = progress.percent / 100;
        onProgress?.(ratio);
        onPhase?.(`Decoding video… ${progress.percent}% (${receivedFrames} face, ${receivedSubjectFrames} subject frames)`);
      } else {
        const ratio = detectedFrames / Math.max(1, receivedFrames);
        onProgress?.(ratio);
        onPhase?.(`FFmpeg complete — finishing ${receivedFrames - detectedFrames} queued detections…`);
      }
    };
    const jobId = createTauriNativeJobId("media");
    summary = await runTauriNativeJob<NativeMediaProgress, NativeMediaExtractionSummary>({
      jobId,
      startCommand: "start_clipper_media_extraction",
      args: {
        filePath: source.filePath,
        startTime: source.startTime,
        endTime: source.endTime,
        intervalSec,
        faceMaxDimension: 960,
        subjectTargetWidth: subjectExtraction?.targetWidth ?? 480,
        includeMotion: Boolean(subjectExtraction),
      },
      signal,
      onProgress: onNativeProgress,
    });
    if (pool) {
      onNativePhase?.("face-worker-drain");
      await pool.drain();
    } else {
      onNativePhase?.("face-worker-drain");
      await detectionChain;
    }
    for (const cutTime of summary.sceneCutTimestamps) {
      cache.markSceneCut(cutTime);
    }
    clipperLog("face analysis: native extraction completed", {
      durationSec: Math.round((performance.now() - extractionStarted) / 100) / 10,
      frameCount: summary.face.frameCount,
      encodedSize: formatBytes(summary.face.encodedBytes),
      dimensions: summary.face.width > 0 ? `${summary.face.width}x${summary.face.height}` : null,
      sceneCuts: summary.sceneCutTimestamps.length,
      detectWorkers: pool ? workerCount : 0,
      subjectFrameCount: summary.subject?.frameCount ?? 0,
    });
    clipperLog("face analysis: hybrid pipeline completed", { receivedFrames, detectedFrames });
    onProgress?.(1);
    onEta?.(0);
    completed = true;
    return summary;
  } finally {
    pool?.dispose();
    // When subject extraction ran, the caller owns cleanup — its detect()
    // calls fetch the same on-disk frames asynchronously and may still be
    // in flight after this resolves (see doc comment above).
    if (summary?.jobId && (!subjectExtraction || !completed)) {
      invoke("cleanup_clipper_frames", { jobId: summary.jobId }).catch(() => {});
    }
  }
}

async function probeClipDuration(file: File): Promise<{ duration: number; hasVideo: boolean }> {
  const input = await createMediabunnyInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return { duration: 0, hasVideo: false };
    return { duration: await input.computeDuration(), hasVideo: true };
  } finally {
    input.dispose();
  }
}

/**
 * Decodes the whole clip once up front and fills `cache` for every sampled
 * timestamp, so the crop is already correctly centered on the very first
 * frame shown — no live "search and center" ramp-in. This is a dedicated
 * decode pass (the one redundant-decode cost the live/on-demand design had
 * avoided), traded back in deliberately: waiting once, up front, beats a
 * visible pan-to-center every time the clip is scrubbed from the start.
 * Shares the same cache the live preview and render read from, so anything
 * already resolved is skipped automatically.
 *
 * For clips long enough to be worth it, this splits the clip into up to
 * `MAX_WORKERS` equal time-slices and detects them concurrently in dedicated
 * Web Workers (`clipper-face-detect.worker.ts`), each running its own
 * MediaPipe instance — detection is otherwise fully serialized through
 * `ToolFaceDetectorService`'s single-flight mutex, so this is the only way to
 * get real multi-core speedup. Short clips (or environments without Worker
 * support) fall back to the original single-threaded path using the
 * caller-supplied singleton `detector`.
 */
export async function prefillFaceSampleCache(
  file: File,
  cache: FaceSampleCache,
  detector: ToolFaceDetectorService,
  options: PrefillFaceSampleCacheOptions = {},
): Promise<ClipperNativeAnalysisSummary | null> {
  const { signal, onProgress, onPhase, onEta, onNativePhase, intervalSec = cache.intervalSec, nativeSource, subjectExtraction } = options;
  if (nativeSource) {
    if (subjectExtraction && clipperWinMlVisionEnabled()) {
      onNativePhase?.("winml-probe");
      const capability = await probeNativeVision();
      if (capability.available) {
        try {
          onNativePhase?.("winml");
          const result = await detectWinMlMedia(nativeSource, cache, signal, onProgress, onPhase, onEta, onNativePhase);
          return result;
        } catch (error) {
          if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
          clipperWarn("face analysis: native WinML failed — restarting atomically with WASM", { error: String(error) });
          onPhase?.("Native vision unavailable — using compatible WASM analysis…");
          onNativePhase?.("wasm-fallback");
        }
      } else {
        clipperWarn("face analysis: native WinML unavailable", {
          code: capability.reasonCode,
          reason: capability.reason,
        });
        onPhase?.("Native vision unavailable — using compatible WASM analysis…");
        onNativePhase?.("wasm-hybrid");
      }
    } else {
      onNativePhase?.("wasm-hybrid");
    }
    try {
      return await detectNativeMedia(
        nativeSource,
        intervalSec,
        cache,
        detector,
        signal,
        onProgress,
        onPhase,
        onEta,
        subjectExtraction,
        onNativePhase,
      );
    } catch (error) {
      if (error instanceof DetectorUnavailableError) cache.markFatal();
      else throw error;
    }
    return null;
  }
  const { duration, hasVideo } = await probeClipDuration(file);
  if (!hasVideo) return null;

  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1;
  const workerCount = Math.max(1, Math.min(MAX_WORKERS, cores));
  const canParallelize =
    workerCount > 1 && typeof Worker !== "undefined" && duration >= MIN_DURATION_FOR_PARALLEL_DETECT_SEC;

  if (!canParallelize) {
    onNativePhase?.("browser-face-detect");
    try {
      await detectFaceSegment({
        file,
        startTime: 0,
        endTime: duration,
        intervalSec,
        detector,
        detectorOptions: CLIPPER_FACE_DETECTOR_OPTIONS,
        signal,
        onSample: (sample) => cache.ingest(sample),
        onProgress,
      });
    } catch (error) {
      if (error instanceof DetectorUnavailableError) {
        cache.markFatal();
      } else {
        throw error;
      }
    }
    onProgress?.(1);
    return null;
  }

  const sliceLength = duration / workerCount;
  const slices = Array.from({ length: workerCount }, (_, i) => ({
    startTime: i * sliceLength,
    endTime: i + 1 === workerCount ? duration : (i + 1) * sliceLength,
  }));

  onNativePhase?.("browser-face-detect-parallel");
  // Slices are equal-length by construction, so a plain average of per-slice
  // ratios is already duration-weighted — no per-slice weight bookkeeping needed.
  const progressBySlice = new Array<number>(workerCount).fill(0);
  const reportProgress = () => {
    const ratio = progressBySlice.reduce((sum, r) => sum + r, 0) / workerCount;
    onProgress?.(Math.min(1, ratio));
  };

  let fatal = false;
  const results = await Promise.allSettled(
    slices.map((slice, i) =>
      detectFaceSegmentWithWorker(file, slice.startTime, slice.endTime, intervalSec, CLIPPER_FACE_DETECTOR_OPTIONS, {
        signal,
        onProgress: (ratio) => {
          progressBySlice[i] = ratio;
          reportProgress();
        },
        onSample: (sample) => cache.ingest(sample),
      }),
    ),
  );

  for (const result of results) {
    if (result.status !== "rejected") continue;
    const error = result.reason;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
    clipperWarn("face analysis — detect worker segment failed", { error: String(error) });
    fatal = true;
  }

  if (fatal) cache.markFatal();
  onProgress?.(1);
  return null;
}

/** Lower alpha = slower/smoother EMA response to new detections. With 0.5s samples, "snappy" prioritizes reaching a new target within the next available sample. */
export const SMOOTHING_ALPHA: Record<ClipperSmoothingStrength, number> = {
  smooth: 0.12,
  balanced: 0.28,
  snappy: 0.85,
};

export function pickPrimaryFace(
  faces: FaceBox[],
  frameW: number,
  frameH: number,
  strategy: ClipperFacePickStrategy,
): FaceBox | null {
  if (faces.length === 0) return null;
  if (strategy === "largest") {
    return faces.reduce((best, f) => (f.width * f.height > best.width * best.height ? f : best));
  }
  const cx = frameW / 2;
  const cy = frameH / 2;
  return faces.reduce((best, f) => {
    const bestDist = Math.hypot(best.x + best.width / 2 - cx, best.y + best.height / 2 - cy);
    const fDist = Math.hypot(f.x + f.width / 2 - cx, f.y + f.height / 2 - cy);
    return fDist < bestDist ? f : best;
  });
}

export interface FaceCentroid {
  x: number;
  y: number;
  extent: number;
}

export function faceToCentroid(face: FaceBox, frameW: number, frameH: number): FaceCentroid {
  const x = (face.x + face.width / 2) / frameW;
  const y = (face.y + face.height / 2) / frameH;
  const diag = Math.hypot(face.width, face.height);
  const frameDiag = Math.hypot(frameW, frameH);
  const extent = frameDiag > 0 ? diag / frameDiag : 0;
  return { x, y, extent };
}

export function blendCentroid(prev: FaceCentroid, next: FaceCentroid, alpha: number): FaceCentroid {
  return {
    x: alpha * next.x + (1 - alpha) * prev.x,
    y: alpha * next.y + (1 - alpha) * prev.y,
    extent: alpha * next.extent + (1 - alpha) * prev.extent,
  };
}

/** Reduces whole-clip face samples to a single smoothed focus track (Face Follow mode). */
export function deriveSingleFocusTrack(
  samples: FaceBoxSample[],
  strategy: ClipperFacePickStrategy,
  smoothing: ClipperSmoothingStrength,
): CentroidSample[] {
  const alpha = SMOOTHING_ALPHA[smoothing];
  const track: CentroidSample[] = [];
  let prev: FaceCentroid | null = null;

  for (const sample of samples) {
    const face = pickPrimaryFace(sample.faces, sample.frameW, sample.frameH, strategy);
    if (!face) {
      if (prev) track.push({ t: sample.time, ...prev });
      continue;
    }
    const centroid = faceToCentroid(face, sample.frameW, sample.frameH);
    const previous: FaceCentroid | null = prev;
    prev = sample.sceneCut || previous === null ? centroid : blendCentroid(previous, centroid, alpha);
    track.push({ t: sample.time, ...prev, cut: sample.sceneCut });
  }

  return track;
}

export interface ClipperCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** A tracked focus point over time; `extent` is the face bbox diagonal / frame diagonal (0..1), used for zoom sizing. */
export interface CentroidSample {
  t: number;
  x: number;
  y: number;
  extent: number;
  /** True when this sample lands on a detected hard cut — the crop should teleport here instead of interpolating from the previous sample. */
  cut?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const HEADROOM_ZOOM_FACTOR: Record<ClipperHeadroom, number> = {
  tight: 2.4,
  normal: 3.6,
  wide: 5.2,
};

/** Never crop tighter than this fraction of the natural (zoom-less) cover crop, to avoid pixelation. */
const MIN_ZOOM_SCALE = 0.28;

function naturalCoverCrop(srcW: number, srcH: number, targetRatio: number): { sw: number; sh: number } {
  const srcRatio = srcW / srcH;
  if (srcRatio > targetRatio) {
    return { sw: srcH * targetRatio, sh: srcH };
  }
  return { sw: srcW, sh: srcW / targetRatio };
}

/**
 * Cover-crop source rect focused on (cx,cy) (0..1 normalized). With no `extent`,
 * this is a plain recentered cover-crop (reduces to a static center crop at
 * cx=cy=0.5). With `extent` (a tracked face's size), the crop additionally
 * zooms in around the face based on `headroom`, gaining freedom to pan on
 * both axes instead of only the axis the aspect ratio forces open.
 */
export function cropRectForCentroid(
  srcW: number,
  srcH: number,
  cx: number,
  cy: number,
  targetRatio: number,
  headroom: ClipperHeadroom,
  extent?: number,
): ClipperCropRect {
  const { sw: naturalSw, sh: naturalSh } = naturalCoverCrop(srcW, srcH, targetRatio);
  let sw = naturalSw;
  let sh = naturalSh;

  if (extent != null && extent > 0) {
    const frameDiagonal = Math.hypot(srcW, srcH);
    const naturalDiagonal = Math.hypot(naturalSw, naturalSh);
    const desiredDiagonal = extent * frameDiagonal * HEADROOM_ZOOM_FACTOR[headroom];
    const scale = naturalDiagonal > 0 ? clamp(desiredDiagonal / naturalDiagonal, MIN_ZOOM_SCALE, 1) : 1;
    sw = naturalSw * scale;
    sh = naturalSh * scale;
  }

  const sx = clamp(cx * srcW - sw / 2, 0, Math.max(0, srcW - sw));
  const sy = clamp(cy * srcH - sh / 2, 0, Math.max(0, srcH - sh));
  return { sx, sy, sw, sh };
}

const FALLBACK_CENTROID: CentroidSample = { t: 0, x: 0.5, y: 0.5, extent: 0 };

function centroidValue(sample: CentroidSample): FaceCentroid {
  return { x: sample.x, y: sample.y, extent: sample.extent };
}

/** Linear interpolation between bracketing samples; holds the nearest edge sample outside the track's range. */
export function interpolateCentroid(
  samples: CentroidSample[],
  t: number,
): { x: number; y: number; extent: number } {
  if (samples.length === 0) return centroidValue(FALLBACK_CENTROID);
  if (t <= samples[0].t) return centroidValue(samples[0]);
  const last = samples[samples.length - 1];
  if (t >= last.t) return centroidValue(last);

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (t >= a.t && t <= b.t) {
      // A hard cut at `b` means the two sides are different shots — hold the
      // pre-cut position until the cut instant, then teleport, instead of
      // easing the camera across a discontinuity that was never really there.
      if (b.cut) return t >= b.t ? b : a;
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        extent: a.extent + (b.extent - a.extent) * f,
      };
    }
  }
  return last;
}
