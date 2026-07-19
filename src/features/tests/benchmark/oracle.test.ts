import { describe, expect, it } from "vitest";
import { calculateLayoutOracle } from "./oracle";

const SOURCE_W = 1920;
const SOURCE_H = 1080;
const TARGET_ASPECT = 9 / 16;

function boxTarget(slot: 0 | 1, x: number, y: number, height: number) {
  const width = (height * SOURCE_H * TARGET_ASPECT) / SOURCE_W;
  return { id: `${slot}`, slot, x, y, width, height };
}

describe("layout oracle", () => {
  it("shows the geometry ceiling gained by splitting distant dual targets", () => {
    const keyframes = [{
      id: "kf",
      timestampUs: 0,
      targets: [
        boxTarget(0, 0.02, 0.1, 0.8),
        boxTarget(1, 0.78, 0.1, 0.8),
      ],
    }];
    const oracle = calculateLayoutOracle({
      timestampsSec: [0],
      keyframes,
      sourceWidth: SOURCE_W,
      sourceHeight: SOURCE_H,
      targetAspectRatio: TARGET_ASPECT,
    });
    expect(oracle.autoSplit.coverageHitRate).toBe(1);
    expect(oracle.autoSplit.dualTargetAllCoveredRate).toBe(1);
    expect(oracle.singleCrop.coverageHitRate).toBeLessThan(1);
  });
});
