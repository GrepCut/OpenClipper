import { describe, expect, it } from "vitest";
import type { BenchmarkResult } from "../types";
import { computeBenchmarkColumnStats } from "./column-stats";

function result(
  aspectId: string,
  metrics: Partial<BenchmarkResult["metricsJson"]>,
): BenchmarkResult {
  return {
    id: aspectId,
    runId: "run",
    clipId: "clip",
    aspectId,
    status: "completed",
    metricsJson: {
      frameCount: 10,
      targetObservationCount: 10,
      coveredTargetCount: 8,
      allTargetsCoveredFrameCount: 8,
      coverageHitCount: 8,
      dualTargetFrameCount: 0,
      dualTargetAllCoveredFrameCount: 0,
      meanCoverageFraction: 0.8,
      allTargetsCoveredFrameRate: 0.8,
      coverageHitRate: 0.8,
      dualTargetAllCoveredRate: null,
      medianCoverageFraction: 0.8,
      p5CoverageFraction: 0.7,
      ...metrics,
    },
    detailsRelativePath: null,
    error: null,
    createdAt: "",
  };
}

describe("computeBenchmarkColumnStats", () => {
  it("summarizes completed clip/aspect rows and ignores failed ones", () => {
    const stats = computeBenchmarkColumnStats([
      result("9-16", {
        meanCoverageFraction: 0.8,
        coverageHitRate: 0.6,
      }),
      result("9-16", {
        meanCoverageFraction: 1,
        coverageHitRate: 1,
      }),
      {
        ...result("9-16", {}),
        status: "failed",
        metricsJson: {} as BenchmarkResult["metricsJson"],
      },
    ]);
    expect(stats.sampleCount).toBe(2);
    expect(stats.portrait9x16.sampleCount).toBe(2);
    expect(stats.coverageHit.median).toBeCloseTo(0.8);
  });
});
