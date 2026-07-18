import { describe, expect, it } from "vitest";
import type { TestKeyframe } from "../types";
import { evaluateGroundTruth } from "./ground-truth";
import { calculateBenchmarkMetrics } from "./metrics";

const frames: TestKeyframe[] = [
  {
    id: "a",
    timestampUs: 1_000_000,
    targets: [{ id: "a0", slot: 0, x: 0.2, y: 0.5, radius: 0.1 }],
  },
  {
    id: "b",
    timestampUs: 2_000_000,
    targets: [
      { id: "b0", slot: 0, x: 0.6, y: 0.5, radius: 0.2 },
      { id: "b1", slot: 1, x: 0.9, y: 0.5, radius: 0.1 },
    ],
  },
];

describe("manual benchmark ground truth", () => {
  it("holds endpoints and linearly interpolates common targets", () => {
    expect(evaluateGroundTruth(frames, 0)[0]!.x).toBe(0.2);
    const middle = evaluateGroundTruth(frames, 1_500_000);
    expect(middle).toHaveLength(1);
    expect(middle[0]!.x).toBeCloseTo(0.4);
    expect(middle[0]!.radius).toBeCloseTo(0.15);
    expect(evaluateGroundTruth(frames, 3_000_000)).toHaveLength(2);
  });

  it("switches target count exactly on the keyframe", () => {
    expect(evaluateGroundTruth(frames, 1_999_999)).toHaveLength(1);
    expect(evaluateGroundTruth(frames, 2_000_000)).toHaveLength(2);
  });
});

describe("benchmark metrics", () => {
  it("accepts one crop containing both target centers", () => {
    const result = calculateBenchmarkMetrics({
      keyframes: [frames[1]!],
      frames: [{ timestampUs: 2_000_000, viewports: [{ x: 0.5, y: 0, width: 0.5, height: 1 }] }],
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    expect(result.metrics.targetVisibilityRate).toBe(1);
    expect(result.metrics.dualTargetAllVisibleRate).toBe(1);
  });

  it("uses split viewports as a union and radius as focus tolerance", () => {
    const result = calculateBenchmarkMetrics({
      keyframes: [frames[1]!],
      frames: [{
        timestampUs: 2_000_000,
        viewports: [
          { x: 0.5, y: 0, width: 0.2, height: 1 },
          { x: 0.8, y: 0, width: 0.2, height: 1 },
        ],
      }],
      sourceWidth: 1000,
      sourceHeight: 1000,
    });
    expect(result.metrics.targetVisibilityRate).toBe(1);
    expect(result.metrics.focusHitRate).toBe(1);
    expect(result.metrics.layoutModeFrameCounts?.split).toBe(1);
    expect(result.details[0]!.layoutMode).toBe("split");
  });

  it("reports single/dual strata and camera motion independently", () => {
    const result = calculateBenchmarkMetrics({
      keyframes: frames,
      frames: [
        { timestampUs: 1_000_000, layoutMode: "single-crop", viewports: [{ x: 0, y: 0, width: 0.4, height: 1 }] },
        { timestampUs: 2_000_000, layoutMode: "contain", viewports: [{ x: 0.5, y: 0, width: 0.5, height: 1 }] },
      ],
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    expect(result.metrics.singleTargetFrameCount).toBe(1);
    expect(result.metrics.layoutModeRates?.["single-crop"]).toBe(0.5);
    expect(result.metrics.layoutModeRates?.contain).toBe(0.5);
    expect(result.metrics.meanViewportCenterVelocity).not.toBeNull();
  });
});
