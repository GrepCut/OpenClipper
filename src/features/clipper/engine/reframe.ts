import type { ClipperFaceSamplesBlob, FaceBox, FaceBoxSample } from "../shared/face-samples";
import type { AutoFlipStaticFeatureSample } from "../shared/smart-crop";
import type { ClipperFacePickStrategy, ClipperHeadroom, ClipperSmoothingStrength } from "../settings/settings";
import { clipperLog } from "../shared/logger";
import {
  createTauriNativeJobId,
  runTauriNativeJob,
} from "../../../shared/utils/tauri-native-jobs";

export type { FaceBox, FaceBoxSample };

/** Sample every 0.5s to keep whole-clip face analysis fast, while still providing a stable focus track. */
export const FACE_SAMPLE_INTERVAL_SEC = 0.5;

export function hasAnyFaces(samples: FaceBoxSample[]): boolean {
  return samples.some((s) => s.faces.length > 0);
}

/**
 * Bucket key for coalescing preview scrub time and render frame PTS onto one
 * cache slot. A 0.5s bucket coalesces requests around each precomputed sample.
 */
export function faceBucketKey(time: number, intervalSec: number = FACE_SAMPLE_INTERVAL_SEC): number {
  return Math.round(time / intervalSec);
}

/** Per-session cache of face detections prefilled by the WinML analysis pass. */
export class FaceSampleCache {
  private samples = new Map<number, FaceBoxSample>();
  private sortedCache: FaceBoxSample[] | null = null;
  private revision = 0;
  readonly intervalSec: number;
  analysisEngine: "winml" = "winml";
  analysisModelVersion = "winml-clipper-vision";

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

  /** Restores many precomputed samples with a single cache invalidation. */
  bulkIngest(samples: FaceBoxSample[]): void {
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

  /** Flags the bucket nearest `time` as a hard cut. */
  markSceneCut(time: number): void {
    const key = faceBucketKey(time, this.intervalSec);
    const sample = this.samples.get(key);
    if (!sample) return;
    sample.sceneCut = true;
    this.invalidateSortedCache();
  }
}

export function hydrateFaceSampleCache(
  cache: FaceSampleCache,
  blob: ClipperFaceSamplesBlob,
): void {
  if (blob.engine && blob.engine !== "winml") return;
  cache.analysisEngine = "winml";
  cache.analysisModelVersion = blob.modelVersion ?? "winml-clipper-vision";
  cache.bulkIngest(blob.samples);
}

export function getClipperDetectorVersion(): string {
  return "winml-clipper-vision-v1-policy3";
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
  onNativePhase?: (phase: string) => void;
  onEta?: (etaSeconds: number | null) => void;
  /** Native Tauri source range — required for WinML analysis. */
  nativeSource?: { filePath: string; startTime: number; endTime: number };
  /** When false, WinML still runs but face samples are not written into the cache (subjects-only resume). */
  ingestFaces?: boolean;
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
  codecDecodeApiMs: number;
  histogramMs: number;
  sampleScaleMs: number;
  frameCopyRotateMs: number;
  borderAnalysisMs: number;
  queueWaitMs: number;
  facePreprocessMs: number;
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
  shadowDiagnostics?: GeneralizationShadowDiagnostics;
}

export interface GeneralizationShadowDiagnostics {
  enabledModels: string[];
  transnetSamples: Array<{
    time: number;
    singleFrameProbability: number;
    manyFrameProbability: number;
    histogramSceneCut: boolean;
  }>;
  saliencyProxySamples?: Array<{
    time: number;
    box: import("../shared/smart-crop").NormalizedBox;
    confidence: number;
    kind: string;
  }>;
  transnetCalibration?: {
    sampleCount: number;
    histogramCutCount: number;
    transnetCutCount: number;
    agreementRate: number;
  };
  reidSamples?: Array<{
    time: number;
    personCount: number;
    embeddingDim: number;
    embeddingNorm: number;
  }>;
  osnetReady?: boolean;
  reidTriggerCount?: number;
  vinetReady?: boolean;
  vinetNote?: string;
}

export interface NativeVisionAnalysisSummary extends NativeVisionCommandSummary {
  subjectSamples: import("../shared/smart-crop").SubjectDetectionSample[];
}

function clipperByteTrackTrackingMode(): "bytetrack-v1" | "off" {
  if (typeof window === "undefined") return "bytetrack-v1";
  const override = window.localStorage?.getItem("clipperByteTrack");
  return override === "false" || override === "0" || override === "off" ? "off" : "bytetrack-v1";
}

async function detectWinMlMedia(
  source: NonNullable<PrefillFaceSampleCacheOptions["nativeSource"]>,
  cache: FaceSampleCache,
  ingestFaces: boolean,
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
  if (ingestFaces) {
    cache.bulkIngest(faceSamples);
  }
  for (const cutTime of summary.sceneCutTimestamps) {
    cache.markSceneCut(cutTime);
  }
  clipperLog("face analysis: WinML pipeline completed", {
    durationSec: Math.round((performance.now() - started) / 100) / 10,
    faceDevice: summary.faceDevice,
    objectDevice: summary.objectDevice,
    poseDevice: summary.poseDevice,
    faceSampleCount: faceSamples.length,
    subjectSampleCount: subjectSamples.length,
    metrics: summary.metrics,
    trackerVersion: summary.trackerVersion ?? null,
    ingestFaces,
  });
  onProgress?.(1);
  onEta?.(0);
  return { ...summary, subjectSamples };
}

/**
 * Prefills the face sample cache via the native WinML pipeline. Requires a
 * native trimmed video path (desktop Windows only).
 */
export async function prefillFaceSampleCache(
  _file: File,
  cache: FaceSampleCache,
  options: PrefillFaceSampleCacheOptions = {},
): Promise<NativeVisionAnalysisSummary> {
  const { signal, onProgress, onPhase, onEta, onNativePhase, nativeSource, ingestFaces = true } = options;
  if (!nativeSource) {
    throw new Error("Smart crop requires a native trimmed video path.");
  }
  onNativePhase?.("winml");
  return detectWinMlMedia(nativeSource, cache, ingestFaces, signal, onProgress, onPhase, onEta, onNativePhase);
}

/** Lower alpha = slower/smoother EMA response to new detections. */
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

export interface CentroidSample {
  t: number;
  x: number;
  y: number;
  extent: number;
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

const MIN_ZOOM_SCALE = 0.28;

function naturalCoverCrop(srcW: number, srcH: number, targetRatio: number): { sw: number; sh: number } {
  const srcRatio = srcW / srcH;
  if (srcRatio > targetRatio) {
    return { sw: srcH * targetRatio, sh: srcH };
  }
  return { sw: srcW, sh: srcW / targetRatio };
}

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
