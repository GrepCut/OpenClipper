import { describe, expect, it } from "vitest";
import type { BenchmarkResult } from "../types";
import { computeBenchmarkColumnStats } from "./column-stats";

function result(
  aspectId: string,
  metrics: Partial<BenchmarkResult["metricsJson"]>,
): BenchmarkResult {
  return {
    id: aspectId,
    runId: "run-1",
    clipId: "clip-1",
    aspectId,
    status: "completed",
    metricsJson: {
      frameCount: 10,
      targetObservationCount: 10,
      visibleTargetCount: 10,
      allTargetsVisibleFrameCount: 10,
      focusHitCount: 8,
      dualTargetFrameCount: 0,
      dualTargetAllVisibleFrameCount: 0,
      targetVisibilityRate: 1,
      allTargetsVisibleFrameRate: 1,
      focusHitRate: 0.8,
      dualTargetAllVisibleRate: null,
      meanFocusErrorRadius: 1,
      medianFocusErrorRadius: 1,
      p95FocusErrorRadius: 2,
      ...metrics,
    },
    detailsRelativePath: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeBenchmarkColumnStats", () => {
  it("summarizes completed clip/aspect rows and ignores failed ones", () => {
    const stats = computeBenchmarkColumnStats([
      result("1-1", {
        targetVisibilityRate: 0.8,
        focusHitRate: 0.6,
        p95FocusErrorRadius: 4,
      }),
      result("16-9", {
        targetVisibilityRate: 1,
        focusHitRate: 1,
        p95FocusErrorRadius: 2,
      }),
      {
        ...result("9-16", {}),
        status: "failed",
        metricsJson: {} as BenchmarkResult["metricsJson"],
      },
    ]);

    expect(stats.sampleCount).toBe(2);
    expect(stats.visible.avg).toBeCloseTo(0.9);
    expect(stats.visible.min).toBeCloseTo(0.8);
    expect(stats.visible.max).toBeCloseTo(1);
    expect(stats.focusHit.median).toBeCloseTo(0.8);
    expect(stats.p95Error.max).toBe(4);
    expect(stats.p95Error.min).toBe(2);
  });
});
