export const TEST_MIN_CLIP_SECONDS = 3;
export const TEST_MAX_CLIP_SECONDS = 60;

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
  /** Normalized source coordinates. */
  x: number;
  y: number;
  /** Source pixels divided by the shorter source dimension. */
  radius: number;
}

export interface TestKeyframe {
  id: string;
  timestampUs: number;
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
  visibleTargetCount: number;
  allTargetsVisibleFrameCount: number;
  focusHitCount: number;
  dualTargetFrameCount: number;
  dualTargetAllVisibleFrameCount: number;
  targetVisibilityRate: number;
  allTargetsVisibleFrameRate: number;
  focusHitRate: number;
  dualTargetAllVisibleRate: number | null;
  meanFocusErrorRadius: number | null;
  medianFocusErrorRadius: number | null;
  p95FocusErrorRadius: number | null;
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
