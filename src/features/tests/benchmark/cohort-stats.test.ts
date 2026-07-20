import { describe, expect, it } from "vitest";
import type { BenchmarkResult, TestClip } from "../types";
import { computeCohortStats } from "./cohort-stats";

function clip(id: string, name: string, cohortTagsJson?: string): TestClip {
  return {
    id,
    datasetId: "ds",
    name,
    originalFileName: `${name}.mp4`,
    mediaRelativePath: `${name}.mp4`,
    duration: 60,
    width: 1920,
    height: 1080,
    frameRate: 30,
    sha256: "sha",
    annotationRevision: 1,
    cohortTagsJson,
    createdAt: "",
    updatedAt: "",
  };
}

function result(clipId: string, aspectId: string, hitRate: number): BenchmarkResult {
  return {
    id: `${clipId}-${aspectId}`,
    runId: "run",
    clipId,
    aspectId,
    status: "completed",
    metricsJson: {
      frameCount: 10,
      targetObservationCount: 10,
      coveredTargetCount: Math.round(hitRate * 10),
      allTargetsCoveredFrameCount: Math.round(hitRate * 10),
      coverageHitCount: Math.round(hitRate * 10),
      dualTargetFrameCount: 0,
      dualTargetAllCoveredFrameCount: 0,
      meanCoverageFraction: hitRate,
      allTargetsCoveredFrameRate: hitRate,
      coverageHitRate: hitRate,
      dualTargetAllCoveredRate: null,
      medianCoverageFraction: hitRate,
      p5CoverageFraction: hitRate,
    },
    detailsRelativePath: null,
    error: null,
    createdAt: "",
  };
}

describe("computeCohortStats", () => {
  it("groups results by stored cohort tags and falls back to name heuristics", () => {
    const clips = [
      clip("a", "mrbeast-interview", '["multi-person-interview"]'),
      clip("b", "spring-animation"),
    ];
    const stats = computeCohortStats(
      [result("a", "9-16", 0.9), result("b", "9-16", 0.5)],
      clips,
    );
    const interview = stats.find((bucket) => bucket.cohort === "multi-person-interview");
    const animation = stats.find((bucket) => bucket.cohort === "animation");
    expect(interview?.clipCount).toBe(1);
    expect(interview?.coverageHit.avg).toBeCloseTo(0.9);
    expect(animation?.clipCount).toBe(1);
    expect(animation?.coverageHit.avg).toBeCloseTo(0.5);
  });
});
