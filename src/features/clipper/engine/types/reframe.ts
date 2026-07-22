import type { FaceBox, FaceBoxSample } from "../../shared/face-samples";
import type { AutoFlipStaticFeatureSample, NormalizedBox, SubjectDetectionSample } from "../../shared/smart-crop";

export type { FaceBox, FaceBoxSample };

export interface ClipperCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface FaceCentroid {
  x: number;
  y: number;
  extent: number;
}

export interface CentroidSample {
  t: number;
  x: number;
  y: number;
  extent: number;
  cut?: boolean;
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
    box: NormalizedBox;
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

export interface NativeVisionCommandSummary {
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

export interface NativeVisionAnalysisSummary extends NativeVisionCommandSummary {
  subjectSamples: SubjectDetectionSample[];
}
