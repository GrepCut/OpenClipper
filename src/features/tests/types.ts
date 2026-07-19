export const TEST_MIN_CLIP_SECONDS = 3;

export interface TestDataset {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestDatasetSummary extends TestDataset {
  clipCount: number;
  annotatedClipCount: number;
  totalDuration: number;
  latestRun: BenchmarkRun | null;
}

export interface TestClip {
  id: string;
  datasetId: string;
  name: string;
  originalFileName: string;
  mediaRelativePath: string;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  sha256: string;
  annotationRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestTarget {
  id: string;
  slot: 0 | 1;
  /** Normalized top-left crop rect in source space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TestLayoutIntent = "crop" | "contain";

export interface TestKeyframe {
  id: string;
  timestampUs: number;
  /** crop: 1–2 targets locked to 9:16. contain: one free-aspect visibility rect. */
  layoutIntent?: TestLayoutIntent;
  targets: TestTarget[];
}

export type BenchmarkRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface BenchmarkRun {
  id: string;
  datasetId: string;
  status: BenchmarkRunStatus;
  selectedClipIdsJson: string[];
  configJson: Record<string, unknown>;
  manifestRelativePath: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface BenchmarkMetrics {
  frameCount: number;
  targetObservationCount: number;
  coveredTargetCount: number;
  allTargetsCoveredFrameCount: number;
  coverageHitCount: number;
  dualTargetFrameCount: number;
  dualTargetAllCoveredFrameCount: number;
  meanCoverageFraction: number;
  allTargetsCoveredFrameRate: number;
  coverageHitRate: number;
  dualTargetAllCoveredRate: number | null;
  medianCoverageFraction: number | null;
  p5CoverageFraction: number | null;
  singleTargetFrameCount?: number;
  singleTargetMeanCoverageFraction?: number | null;
  singleTargetCoverageHitRate?: number | null;
  dualTargetCoverageHitRate?: number | null;
  layoutModeFrameCounts?: Record<"single-crop" | "split" | "contain", number>;
  layoutModeRates?: Record<"single-crop" | "split" | "contain", number>;
  meanViewportCenterVelocity?: number | null;
  p95ViewportCenterVelocity?: number | null;
  p95ViewportCenterAcceleration?: number | null;
  meanCoverageReacquisitionMs?: number | null;
  modeSwitchesPerMinute?: number;
  containDutyCycle?: number;
  medianSubjectDisplayHeightFraction?: number | null;
  p10SubjectDisplayHeightFraction?: number | null;
  missLedger?: Record<"no-evidence" | "identity-mismatch" | "layout-uncovered" | "late-transition" | "interpolation-loss", number>;
  processingMs?: number;
  realtimeFactor?: number;
}

export interface BenchmarkResult {
  id: string;
  runId: string;
  clipId: string;
  aspectId: string;
  status: "completed" | "failed";
  metricsJson: BenchmarkMetrics;
  detailsRelativePath: string | null;
  error: string | null;
  createdAt: string;
}

export const TEST_ASPECTS = [
  { id: "9-16", formatId: "tiktok", label: "9:16", ratio: 9 / 16 },
  { id: "1-1", formatId: "instagram", label: "1:1", ratio: 1 },
  { id: "4-5", formatId: "instagram-portrait", label: "4:5", ratio: 4 / 5 },
  { id: "16-9", formatId: "twitter", label: "16:9", ratio: 16 / 9 },
] as const;
