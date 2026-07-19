import { describe, expect, it } from "vitest";
import type { SubjectDetectionSample } from "../../shared/smart-crop";
import { buildAutoFlipTrack } from "./build-autoflip-track";
import { buildDetectorHypothesisBank } from "./detector-hypotheses";

function samples(): SubjectDetectionSample[] {
  return [0, 0.2, 0.4].map((time, index) => ({
    time,
    sceneCut: index === 0,
    detections: [
      {
        box: { x: 0.1 + index * 0.02, y: 0.1, width: 0.24, height: 0.75 },
        label: "person",
        score: 0.9,
        trackId: 10,
        detectorSource: "ssd" as const,
        associationConfidence: 0.92,
      },
    ],
    shadowDetections: [
      {
        box: { x: 0.11 + index * 0.02, y: 0.11, width: 0.23, height: 0.73 },
        label: "person",
        score: 0.84,
        detectorSource: "yolox" as const,
      },
    ],
    autoflipFaces: [
      {
        box: { x: 0.16 + index * 0.02, y: 0.14, width: 0.1, height: 0.13 },
        keypoints: [],
        trackId: 100,
      },
    ],
    poseSubjects: [
      {
        box: { x: 0.12 + index * 0.02, y: 0.12, width: 0.2, height: 0.68 },
        score: 0.88,
        trackId: 200,
      },
    ],
    importanceSignals: [
      {
        box: { x: 0.12 + index * 0.02, y: 0.12, width: 0.2, height: 0.68 },
        kind: "video-saliency" as const,
        confidence: 0.8,
      },
    ],
  }));
}

describe("detector hypothesis bank", () => {
  it("keeps SSD and YOLOX separate while recording legal agreement and persistence features", () => {
    const bank = buildDetectorHypothesisBank(samples());
    const first = bank[0]!.hypotheses;
    expect(first.map((hypothesis) => hypothesis.source)).toEqual([
      "ssd",
      "yolox",
    ]);
    expect(first[0]!.observations.map((item) => item.source)).toEqual([
      "ssd",
      "face",
      "pose",
    ]);
    expect(first[1]!.observations.map((item) => item.source)).toEqual([
      "yolox",
      "face",
      "pose",
    ]);
    expect(first[0]!.features.detectorAgreementIou).toBeGreaterThan(0.8);
    expect(first[0]!.features.faceSupport).toBe(1);
    expect(first[0]!.features.poseSupport).toBeCloseTo(0.88);
    expect(bank[2]!.hypotheses[0]!.features.trackPersistenceSamples).toBe(3);
    expect(bank[2]!.hypotheses[0]!.features.trackAgeSec).toBeCloseTo(0.4);
    expect(bank[2]!.hypotheses[0]!.features.speed).toBeGreaterThan(0);
    expect(bank[2]!.hypotheses[0]!.features.saliencyOverlap).toBeGreaterThan(
      0.5,
    );
  });

  it("is side-effect free and cannot change production layout output", () => {
    const inputSamples = samples();
    const snapshot = JSON.stringify(inputSamples);
    const build = () =>
      buildAutoFlipTrack({
        clipStart: 0,
        clipEnd: 0.4,
        detections: inputSamples,
        faces: [],
        sceneCuts: [0],
        targetAspectRatios: { tiktok: 9 / 16 },
        frameWidth: 1920,
        frameHeight: 1080,
        sourceFrameRate: 5,
        iteration10: true,
      });
    const before = build();
    buildDetectorHypothesisBank(inputSamples);
    const after = build();
    expect(JSON.stringify(inputSamples)).toBe(snapshot);
    expect(after.aspectTracks).toEqual(before.aspectTracks);
    expect(after.layoutTracks).toEqual(before.layoutTracks);
  });
});
