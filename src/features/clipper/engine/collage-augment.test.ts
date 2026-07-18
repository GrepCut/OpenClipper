import { describe, expect, it } from "vitest";
import type { FaceBoxSample } from "../shared/face-samples";
import type { SubjectDetectionSample } from "../shared/smart-crop";

// reframe.ts also owns native analysis helpers whose dispatcher is installed
// at module load. The production runtime always has Window; provide the
// minimal equivalent before dynamically importing the pure collage engine.
(globalThis as typeof globalThis & { window: typeof globalThis }).window = globalThis;

const { augmentFaceSamplesWithDetectedHeads, deriveTwoSpeakerRegions } = await import("./collage");

const FRAME_W = 1920;
const FRAME_H = 1080;

function faceSample(time: number, faces: Array<{ x: number; y: number; width: number; height: number }>): FaceBoxSample {
  return { time, faces, frameW: FRAME_W, frameH: FRAME_H };
}

function personSample(time: number, xs: number[], trackIds?: number[]): SubjectDetectionSample {
  return {
    time,
    detections: xs.map((x, index) => ({
      box: { x: x - 0.1, y: 0.1, width: 0.2, height: 0.8 },
      label: "person",
      score: 0.9,
      trackId: trackIds?.[index],
    })),
  };
}

describe("augmentFaceSamplesWithDetectedHeads", () => {
  it("adds a synthetic head for a persistent tracked person the face detector missed", () => {
    const faceSamples = [faceSample(0.5, [{ x: 1300, y: 250, width: 150, height: 170 }])];
    const detections = [personSample(0.3, [0.3], [1]), personSample(0.5, [0.3], [1])];
    const augmented = augmentFaceSamplesWithDetectedHeads(faceSamples, detections);
    expect(augmented[0]!.faces).toHaveLength(2);
    const synthetic = augmented[0]!.faces[1]!;
    expect(synthetic.y).toBeCloseTo(0.1 * FRAME_H, 3);
    expect(synthetic.x).toBeGreaterThan(0.2 * FRAME_W);
    expect(synthetic.x).toBeLessThan(0.4 * FRAME_W);
  });

  it("requires persistence across consecutive detection samples", () => {
    const faceSamples = [faceSample(0.5, [])];
    const flicker = [personSample(0.5, [0.3], [1])];
    expect(augmentFaceSamplesWithDetectedHeads(faceSamples, flicker)[0]!.faces).toHaveLength(0);
  });

  it("does not duplicate a person whose face was already detected", () => {
    // Face box overlapping the person's head band.
    const faceSamples = [faceSample(0.5, [{ x: 0.25 * FRAME_W, y: 0.12 * FRAME_H, width: 150, height: 170 }])];
    const detections = [personSample(0.3, [0.3], [1]), personSample(0.5, [0.3], [1])];
    const augmented = augmentFaceSamplesWithDetectedHeads(faceSamples, detections);
    expect(augmented[0]!.faces).toHaveLength(1);
  });

  it("opens a two-speaker region once the missed face is synthesized", () => {
    // Real face on the right only; person detector tracks both speakers.
    const times = [0, 0.5, 1, 1.5, 2];
    const faceSamples = times.map((t) => faceSample(t, [{ x: 1300, y: 250, width: 150, height: 170 }]));
    const detections = times.flatMap((t) => [
      personSample(t - 0.2, [0.3, 0.72], [1, 2]),
      personSample(t, [0.3, 0.72], [1, 2]),
    ]);
    const withoutHeads = deriveTwoSpeakerRegions(faceSamples);
    expect(withoutHeads).toHaveLength(0);
    const augmented = augmentFaceSamplesWithDetectedHeads(faceSamples, detections);
    const regions = deriveTwoSpeakerRegions(augmented);
    expect(regions.length).toBeGreaterThan(0);
  });
});
