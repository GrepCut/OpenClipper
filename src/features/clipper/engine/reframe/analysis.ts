import type { ClipperFaceSamplesBlob, FaceBox, FaceBoxSample } from "../../shared/face-samples";
import type { AutoFlipStaticFeatureSample } from "../../shared/smart-crop";
import { clipperLog } from "../../shared/logger";
import {
  createTauriNativeJobId,
  runTauriNativeJob,
} from "../../../../shared/utils/tauri-native-jobs";
import { FaceSampleCache } from "./cache";

export type { FaceBox, FaceBoxSample };

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
  subjectSample?: import("../../shared/smart-crop").SubjectDetectionSample;
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
    box: import("../../shared/smart-crop").NormalizedBox;
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
  subjectSamples: import("../../shared/smart-crop").SubjectDetectionSample[];
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
  const subjectSamples: import("../../shared/smart-crop").SubjectDetectionSample[] = [];
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
