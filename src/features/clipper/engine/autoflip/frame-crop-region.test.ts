import { describe, expect, it } from "vitest";
import { computeFrameCropRegionResult, focusBandRegions } from "./frame-crop-region";
import type { SalientRegion } from "./types";

const face: SalientRegion = {
  box: { x: 0.27, y: 0.27, width: 0.06, height: 0.06 },
  score: 0.88,
  signalType: "face_core",
  isRequired: false,
};

const human: SalientRegion = {
  box: { x: 0.2, y: 0.1, width: 0.25, height: 0.85 },
  score: 0.78,
  signalType: "human",
  isRequired: false,
};

const backgroundObject: SalientRegion = {
  box: { x: 0.7, y: 0.6, width: 0.1, height: 0.1 },
  score: 0.15,
  signalType: "object",
  isRequired: false,
};

const poseHead: SalientRegion = {
  box: { x: 0.7, y: 0.2, width: 0.08, height: 0.1 },
  score: 0.8,
  signalType: "pose_head",
  isRequired: false,
};

describe("focusBandRegions", () => {
  it("prefers faces over bodies over objects", () => {
    expect(focusBandRegions([face, human, backgroundObject]).map((r) => r.signalType)).toEqual(["face_core"]);
    expect(focusBandRegions([human, backgroundObject]).map((r) => r.signalType)).toEqual(["human"]);
    expect(focusBandRegions([backgroundObject]).map((r) => r.signalType)).toEqual(["object"]);
    expect(focusBandRegions([face, poseHead]).map((r) => r.signalType)).toEqual(["face_core"]);
    expect(focusBandRegions([poseHead, human]).map((r) => r.signalType)).toEqual(["pose_head"]);
  });
});

describe("computeFrameCropRegionResult focus", () => {
  it("puts the focus centre on the face despite a far background object", () => {
    const result = computeFrameCropRegionResult({
      frameWidth: 1920,
      frameHeight: 1080,
      targetAspectRatio: 9 / 16,
      regions: [face, human, backgroundObject],
    });
    expect(result.focusCenter).toBeDefined();
    expect(result.focusCenter!.x).toBeCloseTo(0.3, 1);
    expect(result.focusCenter!.y).toBeCloseTo(0.3, 1);
    expect(result.focusBox).toBeDefined();
    expect(result.focusBox!.height).toBeLessThan(0.1);
  });

  it("centres between two faces", () => {
    const other: SalientRegion = { ...face, box: { x: 0.67, y: 0.27, width: 0.06, height: 0.06 } };
    const result = computeFrameCropRegionResult({
      frameWidth: 1920,
      frameHeight: 1080,
      targetAspectRatio: 9 / 16,
      regions: [face, other],
    });
    expect(result.focusCenter!.x).toBeCloseTo(0.5, 1);
  });
});
