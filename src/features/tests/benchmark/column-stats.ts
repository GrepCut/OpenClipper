import type { BenchmarkResult } from "../types";

export interface ColumnStatSummary {
  avg: number | null;
  median: number | null;
  max: number | null;
  min: number | null;
}

export interface BenchmarkColumnStats {
  visible: ColumnStatSummary;
  focusHit: ColumnStatSummary;
  p95Error: ColumnStatSummary;
  sampleCount: number;
}

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const factor = index - lower;
  return sorted[lower]! * (1 - factor) + sorted[upper]! * factor;
}

function summarizeValues(values: number[]): ColumnStatSummary {
  if (!values.length) {
    return { avg: null, median: null, max: null, min: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    avg: sum / sorted.length,
    median: quantile(sorted, 0.5),
    max: sorted[sorted.length - 1]!,
    min: sorted[0]!,
  };
}

export function computeBenchmarkColumnStats(results: BenchmarkResult[]): BenchmarkColumnStats {
  const completed = results.filter((result) => result.status === "completed");
  return {
    visible: summarizeValues(
      completed.map((result) => result.metricsJson.targetVisibilityRate).filter((value) => value != null),
    ),
    focusHit: summarizeValues(
      completed.map((result) => result.metricsJson.focusHitRate).filter((value) => value != null),
    ),
    p95Error: summarizeValues(
      completed
        .map((result) => result.metricsJson.p95FocusErrorRadius)
        .filter((value): value is number => value != null),
    ),
    sampleCount: completed.length,
  };
}
