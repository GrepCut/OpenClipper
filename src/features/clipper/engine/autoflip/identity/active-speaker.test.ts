import { describe, expect, it } from "vitest";
import type { SubjectDetectionSample } from "../../../shared/smart-crop";
import { attachActiveSpeakerSignals } from "./active-speaker";

function sample(index: number, score = 0.8): SubjectDetectionSample {
  return {
    time: index * 0.2,
    detections: [],
    autoflipFaces: [
      { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 }, keypoints: [], trackId: 1 },
      { box: { x: 0.7, y: 0.1, width: 0.2, height: 0.3 }, keypoints: [], trackId: 2 },
    ],
    activeSpeakerScores: [{ trackId: 1, confidence: score }, { trackId: 2, confidence: 0.3 }],
  };
}

describe("active speaker policy", () => {
  it("waits for a stable multi-face span and attaches the existing face track", () => {
    const result = attachActiveSpeakerSignals(Array.from({ length: 6 }, (_, index) => sample(index)));
    expect(result.slice(0, 5).every((entry) => !entry.importanceSignals?.length)).toBe(true);
    expect(result[5]!.importanceSignals![0]).toMatchObject({ kind: "active-speaker", trackId: 1 });
  });

  it("resets the multi-face window at scene cuts", () => {
    const samples = Array.from({ length: 8 }, (_, index) => sample(index));
    samples[4]!.sceneCut = true;
    expect(attachActiveSpeakerSignals(samples).every((entry) => !entry.importanceSignals?.length)).toBe(true);
  });

  it("does not synthesize a target for an unknown or ambiguous speaker", () => {
    const ambiguous = Array.from({ length: 6 }, (_, index) => sample(index, 0.55));
    ambiguous.forEach((entry) => { entry.activeSpeakerScores = [{ trackId: 99, confidence: 0.99 }]; });
    expect(attachActiveSpeakerSignals(ambiguous).every((entry) => !entry.importanceSignals?.length)).toBe(true);
  });
});
