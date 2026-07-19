import { describe, expect, it } from "vitest";
import type { ClipperLayoutTrack } from "../../../clipper/shared/smart-crop";
import { interpolateLayoutSample } from "../../../clipper/engine/autoflip/layout-planner";
import type { BenchmarkFrameDetail } from "../metrics";
import { composeFrames, type ReplayedSample } from "./replay-engine";

const box = (x: number) => ({ x, y: 0.1, width: 0.3, height: 0.8 });

function baselineRow(timestampUs: number): BenchmarkFrameDetail {
  return {
    timestampUs,
    targetCount: 1,
    allTargetsCovered: true,
    viewports: [{ x: 0.05, y: 0, width: 0.4, height: 1 }],
    layoutMode: "single-crop",
    targets: [{ slot: 0, coverageHit: true, coverageFraction: 0.95 }],
  };
}

describe("replay frame composition", () => {
  it("matches interpolateLayoutSample semantics for semantic spans, cuts and strategy flips", () => {
    // Sample layout: semantic pair (interpolates), strategy flip (holds), cut (holds).
    const samples: ReplayedSample[] = [
      { t: 0.0, cut: false, mode: "single-crop", strategy: "semantic-single", viewports: [box(0.1)] },
      { t: 0.2, cut: false, mode: "single-crop", strategy: "semantic-single", viewports: [box(0.3)] },
      { t: 0.4, cut: false, mode: "single-crop", strategy: "legacy-baseline", viewports: [box(0.5)] },
      { t: 0.6, cut: true, mode: "single-crop", strategy: "semantic-single", viewports: [box(0.7)] },
      { t: 0.8, cut: false, mode: "single-crop", strategy: "semantic-single", viewports: [box(0.9)] },
    ];
    const track: ClipperLayoutTrack = {
      targetAspectRatio: 9 / 16,
      samples: samples.map((sample) => ({
        t: sample.t,
        mode: sample.mode,
        strategy: sample.strategy,
        viewports: sample.viewports,
        candidateMode: sample.mode,
        candidateViewports: sample.viewports,
        requiredRegionIds: [],
        cut: sample.cut,
      })),
    };
    const timestamps = [0, 50_000, 100_000, 150_000, 250_000, 450_000, 550_000, 700_000, 900_000];
    const frames = composeFrames(samples, timestamps.map(baselineRow));
    for (const [index, timestampUs] of timestamps.entries()) {
      const time = timestampUs / 1_000_000;
      const production = interpolateLayoutSample(track, time);
      const frame = frames[index]!;
      if (!production?.viewports.length || production.strategy === "legacy-baseline") {
        expect(frame.viewports).toEqual(baselineRow(timestampUs).viewports);
        expect(frame.layoutMode).toBe("single-crop");
      } else {
        expect(frame.viewports).toEqual(production.viewports);
        expect(frame.layoutMode).toBe(production.mode);
      }
    }
  });

  it("falls back to the recorded baseline row for legacy frames, keeping collage splits", () => {
    const samples: ReplayedSample[] = [
      { t: 0, cut: false, mode: "single-crop", strategy: "legacy-baseline", viewports: [box(0.2)] },
    ];
    const collageRow: BenchmarkFrameDetail = {
      ...baselineRow(100_000),
      viewports: [
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.5, y: 0, width: 0.5, height: 1 },
      ],
      layoutMode: "split",
    };
    const frames = composeFrames(samples, [collageRow]);
    expect(frames[0]!.viewports).toHaveLength(2);
    expect(frames[0]!.layoutMode).toBe("split");
  });
});
