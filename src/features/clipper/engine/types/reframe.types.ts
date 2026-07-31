import type { FaceBox, FaceBoxSample } from "../../shared/face-samples.util";
import type {
  AutoFlipStaticFeatureSample,
  NormalizedBox,
  SubjectDetectionSample,
} from "../../shared/smart-crop.util";

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
  /** Benchmark-only detector recovery ablations. Production leaves all flags false. */
  visionAblation?: VisionAblationConfig;
}

export type NativeVisionDevice = "directx-high-performance" | "cpu";

export interface VisionAblationConfig {
  disableObjectTileRecovery?: boolean;
  disableFaceTileRecovery?: boolean;
}

export interface NativeVisionMetrics {
  decodeDurationMs: number;
  inferenceDurationMs: number;
  analysisDurationMs: number;
  mergeDurationMs: number;
  resultChunkCount: number;
  drainDurationMs: number;
  faceInferenceMs: number;
  objectInferenceMs: number;
  poseInferenceMs: number;
  baseFacePasses: number;
  baseObjectPasses: number;
  basePosePasses: number;
  recoveryFacePasses: number;
  recoveryObjectPasses: number;
  baseFaceInferenceMs: number;
  recoveryFaceInferenceMs: number;
  baseObjectInferenceMs: number;
  recoveryObjectInferenceMs: number;
  basePoseInferenceMs: number;
  faceInferenceCalls: number;
  faceMultiframeInferenceCalls: number;
  faceFullBatchCount: number;
  faceInferenceFrames: number;
  faceBatchCollectWaitMs: number;
  objectPreprocessMs: number;
  objectDecodeMs: number;
  zeroCopyTileCount: number;
  zeroCopyTileBytesAvoided: number;
  yoloxFastDecodeSkippedRows: number;
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
  trackerVersion?: "bytetrack-v1" | "bytetrack-v2";
  metrics: NativeVisionMetrics;
}

export interface NativeVisionAnalysisSummary extends NativeVisionCommandSummary {
  subjectSamples: SubjectDetectionSample[];
}
