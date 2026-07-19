import type { BenchmarkResult } from "../types";

export interface ColumnStatSummary {
  avg: number | null;
  median: number | null;
  max: number | null;
  min: number | null;
}

export interface BenchmarkColumnStats {
  coverage: ColumnStatSummary;
  coverageHit: ColumnStatSummary;
  p5Coverage: ColumnStatSummary;
  sampleCount: number;
  /** Primary product target; the all-aspect aggregate is retained for compatibility. */
  portrait9x16: {
    coverage: ColumnStatSummary;
    coverageHit: ColumnStatSummary;
    dualAllCovered: ColumnStatSummary;
    sampleCount: number;
  };
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
  const portrait = completed.filter((result) => result.aspectId === "9-16");
  return {
    coverage: summarizeValues(
      completed.map((result) => result.metricsJson.meanCoverageFraction).filter((value) => value != null),
    ),
    coverageHit: summarizeValues(
      completed.map((result) => result.metricsJson.coverageHitRate).filter((value) => value != null),
    ),
    p5Coverage: summarizeValues(
      completed
        .map((result) => result.metricsJson.p5CoverageFraction)
        .filter((value): value is number => value != null),
    ),
    sampleCount: completed.length,
    portrait9x16: {
      coverage: summarizeValues(portrait.map((result) => result.metricsJson.meanCoverageFraction)),
      coverageHit: summarizeValues(portrait.map((result) => result.metricsJson.coverageHitRate)),
      dualAllCovered: summarizeValues(
        portrait
          .map((result) => result.metricsJson.dualTargetAllCoveredRate)
          .filter((value): value is number => value != null),
      ),
      sampleCount: portrait.length,
    },
  };
}
