import { describe, expect, it } from "vitest";
import type { ImportanceSignalSample } from "../../shared/smart-crop";
import type { KeyFrameSalientInput, SalientRegion } from "./types";
import { attachImportanceSignals, buildImportanceTimeline } from "./importance-ranker";

function region(
  signalType: SalientRegion["signalType"],
  x: number,
  score = 0.85,
  trackId?: number,
): SalientRegion {
  return {
    box: { x, y: 0.2, width: 0.16, height: 0.24 },
    score,
    signalType,
    isRequired: false,
    trackId,
  };
}

describe("human importance ranking", () => {
  it("fuses overlapping face and body evidence even when their tracker ids differ", () => {
    const timeline = buildImportanceTimeline([{
      time: 0,
      isShotChange: false,
      regions: [
        {
          ...region("face_full", 0.42, 0.92, 7),
          box: { x: 0.44, y: 0.16, width: 0.12, height: 0.16 },
        },
        {
          ...region("human", 0.34, 0.85, 31),
          box: { x: 0.34, y: 0.12, width: 0.32, height: 0.72 },
        },
      ],
    }]);

    expect(timeline[0]!.regions).toHaveLength(1);
    expect(timeline[0]!.regions[0]!.sources).toEqual(expect.arrayContaining(["head", "person"]));
  });

  it("keeps a salient screen beside a face instead of globally discarding non-face signals", () => {
    const keyframes: KeyFrameSalientInput[] = [{
      time: 0,
      isShotChange: false,
      regions: [region("face_full", 0.08, 0.9, 1), region("human", 0.06, 0.8, 1)],
    }];
    const signals: ImportanceSignalSample[] = [{
      time: 0,
      regions: [{
        box: { x: 0.62, y: 0.12, width: 0.3, height: 0.55 },
        kind: "screen",
        confidence: 0.95,
        trackId: 99,
      }],
    }];
    const timeline = buildImportanceTimeline(attachImportanceSignals(keyframes, signals));
    const required = timeline[0]!.regions.filter((item) => item.required);

    expect(required).toHaveLength(2);
    expect(required.map((item) => item.kind)).toContain("screen");
    expect(required.some((item) => item.sources.includes("head") || item.sources.includes("person"))).toBe(true);
  });

  it("retains the current primary when a challenger only has a small transient advantage", () => {
    const timeline = buildImportanceTimeline([
      { time: 0, isShotChange: false, regions: [region("face_full", 0.1, 0.9, 1), region("face_full", 0.7, 0.7, 2)] },
      { time: 0.2, isShotChange: false, regions: [region("face_full", 0.1, 0.8, 1), region("face_full", 0.7, 0.9, 2)] },
    ]);

    expect(timeline[0]!.regions.find((item) => item.role === "primary")!.trackId).toBe(1);
    expect(timeline[1]!.regions.find((item) => item.role === "primary")!.trackId).toBe(1);
  });

  it("treats three similarly strong people as one group instead of an arbitrary split pair", () => {
    const timeline = buildImportanceTimeline([{
      time: 0,
      isShotChange: false,
      regions: [region("face_full", 0.05, 0.9, 1), region("face_full", 0.4, 0.88, 2), region("face_full", 0.75, 0.86, 3)],
    }]);
    const required = timeline[0]!.regions.filter((item) => item.required);
    expect(required).toHaveLength(1);
    expect(required[0]!.kind).toBe("action");
    expect(required[0]!.contentBox.width).toBeGreaterThan(0.7);
  });

  it("never promotes standalone frame-difference motion to an editing target", () => {
    const timeline = buildImportanceTimeline([{
      time: 0,
      isShotChange: false,
      regions: [region("motion", 0.7, 0.99, 77)],
    }]);
    expect(timeline[0]!.regions).toEqual([]);
  });
});
