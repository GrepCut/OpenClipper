import { describe, expect, it } from "vitest";
import type { TestKeyframe } from "../types";
import { calculateLayoutOracle } from "./oracle";

describe("layout oracle", () => {
  it("shows the geometry ceiling gained by splitting distant dual targets", () => {
    const keyframes: TestKeyframe[] = [{
      id: "frame",
      timestampUs: 0,
      targets: [
        { id: "left", slot: 0, x: 0.08, y: 0.5, radius: 0.05 },
        { id: "right", slot: 1, x: 0.92, y: 0.5, radius: 0.05 },
      ],
    }];
    const oracle = calculateLayoutOracle({
      timestampsSec: [0],
      keyframes,
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetAspectRatio: 9 / 16,
    });
    expect(oracle.autoSplit.focusHitRate).toBe(1);
    expect(oracle.autoSplit.dualTargetAllVisibleRate).toBe(1);
    expect(oracle.singleCrop.focusHitRate).toBeLessThan(1);
  });
});
