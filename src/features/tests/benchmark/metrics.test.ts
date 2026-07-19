import { describe, expect, it } from "vitest";
import type { TestTarget } from "../types";
import {
  COVERAGE_HIT_THRESHOLD,
  defaultTargetRect,
  isValidTargetAspect,
  resizeTargetFromCorner,
  TARGET_ASPECT,
} from "./target-geometry";

const SOURCE_W = 1920;
const SOURCE_H = 1080;

function boxTarget(slot: 0 | 1, x: number, y: number, height: number): TestTarget {
  const width = (height * SOURCE_H * TARGET_ASPECT) / SOURCE_W;
  return { id: `${slot}`, slot, x, y, width, height };
}

describe("target geometry", () => {
  it("creates default 9:16 rects", () => {
    const rect = defaultTargetRect(SOURCE_W, SOURCE_H);
    expect(isValidTargetAspect(rect, SOURCE_W, SOURCE_H)).toBe(true);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("keeps 9:16 while resizing from the corner", () => {
    const start = boxTarget(0, 0.2, 0.1, 0.5);
    const resized = resizeTargetFromCorner(start, { x: 0.5, y: 0.9 }, SOURCE_W, SOURCE_H);
    expect(isValidTargetAspect(resized, SOURCE_W, SOURCE_H)).toBe(true);
    expect(resized.width).toBeGreaterThan(start.width);
  });
});

describe("manual benchmark ground truth", () => {
  const frames = [
    {
      id: "a",
      timestampUs: 1_000_000,
      targets: [boxTarget(0, 0.1, 0.1, 0.5)],
    },
    {
      id: "b",
      timestampUs: 2_000_000,
      targets: [
        boxTarget(0, 0.4, 0.1, 0.6),
        boxTarget(1, 0.7, 0.1, 0.4),
      ],
    },
  ];

  it("holds endpoints and linearly interpolates common targets", async () => {
    const { evaluateGroundTruth } = await import("./ground-truth");
    expect(evaluateGroundTruth(frames, 0)[0]!.x).toBe(0.1);
    const middle = evaluateGroundTruth(frames, 1_500_000);
    expect(middle).toHaveLength(1);
    expect(middle[0]!.x).toBeCloseTo(0.25);
    expect(middle[0]!.height).toBeCloseTo(0.55);
    expect(evaluateGroundTruth(frames, 3_000_000)).toHaveLength(2);
  });

  it("switches target count exactly on the keyframe", async () => {
    const { evaluateGroundTruth } = await import("./ground-truth");
    expect(evaluateGroundTruth(frames, 1_999_999)).toHaveLength(1);
    expect(evaluateGroundTruth(frames, 2_000_000)).toHaveLength(2);
  });
});

describe("benchmark metrics", () => {
  const dualKeyframe = {
    id: "b",
    timestampUs: 2_000_000,
    targets: [
      boxTarget(0, 0.05, 0, 1),
      boxTarget(1, 0.75, 0, 1),
    ],
  };

  it("counts full coverage as a hit", async () => {
    const { calculateBenchmarkMetrics } = await import("./metrics");
    const result = calculateBenchmarkMetrics({
      keyframes: [dualKeyframe],
      frames: [{ timestampUs: 2_000_000, viewports: [{ x: 0.75, y: 0, width: 0.25, height: 1 }] }],
      sourceWidth: SOURCE_W,
      sourceHeight: SOURCE_H,
    });
    expect(result.metrics.meanCoverageFraction).toBeGreaterThan(0);
    expect(result.metrics.dualTargetAllCoveredRate).toBe(0);
  });

  it("uses split viewports and the coverage threshold", async () => {
    const { calculateBenchmarkMetrics } = await import("./metrics");
    const left = boxTarget(0, 0.05, 0, 1);
    const right = boxTarget(1, 0.75, 0, 1);
    const result = calculateBenchmarkMetrics({
      keyframes: [{ id: "b", timestampUs: 2_000_000, targets: [left, right] }],
      frames: [{
        timestampUs: 2_000_000,
        viewports: [
          { x: left.x, y: 0, width: left.width, height: 1 },
          { x: right.x, y: 0, width: right.width, height: 1 },
        ],
      }],
      sourceWidth: SOURCE_W,
      sourceHeight: SOURCE_H,
    });
    expect(result.metrics.meanCoverageFraction).toBe(1);
    expect(result.metrics.coverageHitRate).toBe(1);
    expect(result.metrics.dualTargetAllCoveredRate).toBe(1);
    expect(result.metrics.layoutModeFrameCounts?.split).toBe(1);
  });

  it("marks partial coverage below threshold as a miss", async () => {
    const { calculateBenchmarkMetrics } = await import("./metrics");
    const target = boxTarget(0, 0.2, 0.2, 0.5);
    const result = calculateBenchmarkMetrics({
      keyframes: [{ id: "a", timestampUs: 0, targets: [target] }],
      frames: [{
        timestampUs: 0,
        viewports: [{ x: 0.2, y: 0.2, width: target.width * 0.7, height: target.height * 0.7 }],
      }],
      sourceWidth: SOURCE_W,
      sourceHeight: SOURCE_H,
    });
    expect(result.metrics.coverageHitRate).toBe(0);
    expect(result.details[0]!.targets[0]!.coverageFraction).toBeLessThan(COVERAGE_HIT_THRESHOLD);
  });
});
