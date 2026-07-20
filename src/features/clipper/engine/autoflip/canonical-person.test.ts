import { describe, expect, it } from "vitest";
import type { SubjectDetectionSample } from "../../shared/smart-crop";
import { buildCanonicalPersonTracks } from "./canonical-person";

const box = (x: number) => ({ x, y: 0.15, width: 0.2, height: 0.7 });
const face = (x: number) => ({ x: x + 0.05, y: 0.18, width: 0.1, height: 0.15 });

function twoPeople(time: number, leftX: number, rightX: number, ids = [10, 20]): SubjectDetectionSample {
  return {
    time,
    detections: [
      { box: box(leftX), label: "person", score: 0.9, trackId: ids[0] },
      { box: box(rightX), label: "person", score: 0.9, trackId: ids[1] },
    ],
    autoflipFaces: [
      { box: face(leftX), keypoints: [], trackId: 100 + ids[0]! },
      { box: face(rightX), keypoints: [], trackId: 100 + ids[1]! },
    ],
  };
}

describe("canonical person fusion", () => {
  it("keeps canonical ids while two people cross", () => {
    const result = buildCanonicalPersonTracks([
      twoPeople(0, 0.1, 0.7),
      twoPeople(0.2, 0.3, 0.5),
      twoPeople(0.4, 0.55, 0.25),
    ]);
    expect(result.samples[0]!.detections.map((item) => item.trackId)).toEqual([1, 2]);
    expect(result.samples[2]!.detections.map((item) => item.trackId)).toEqual([1, 2]);
    expect(result.samples[2]!.autoflipFaces!.map((item) => item.trackId)).toEqual([1, 2]);
  });

  it("reacquires the same id after a short occlusion", () => {
    const samples = [
      twoPeople(0, 0.1, 0.7),
      {
        ...twoPeople(0.2, 0.12, 0.68),
        detections: [twoPeople(0.2, 0.12, 0.68).detections[1]!],
        autoflipFaces: [twoPeople(0.2, 0.12, 0.68).autoflipFaces![1]!],
      },
      twoPeople(0.4, 0.14, 0.66),
    ];
    const result = buildCanonicalPersonTracks(samples);
    expect(result.samples[2]!.detections[0]!.trackId).toBe(1);
    expect(result.telemetry.successfulReacquisitions).toBeGreaterThan(0);
  });

  it("does not create a third identity from duplicate pose evidence", () => {
    const sample = twoPeople(0, 0.1, 0.7);
    sample.poseSubjects = [{ box: box(0.1), score: 0.9, trackId: 999 }];
    const result = buildCanonicalPersonTracks([sample]);
    expect(result.samples[0]!.canonicalPersons).toHaveLength(2);
    expect(result.samples[0]!.poseSubjects![0]!.trackId).toBe(1);
  });

  it("resets ids and associations at a scene cut", () => {
    const first = twoPeople(0, 0.1, 0.7);
    const second = twoPeople(1, 0.7, 0.1, [20, 10]);
    second.sceneCut = true;
    const result = buildCanonicalPersonTracks([first, second]);
    expect(result.samples[1]!.detections.map((item) => item.trackId)).toEqual([1, 2]);
    expect(result.telemetry.deaths).toBeGreaterThanOrEqual(2);
  });

  it("keeps three similarly important observed people as three identities", () => {
    const sample = twoPeople(0, 0.05, 0.7);
    sample.detections.push({ box: box(0.38), label: "person", score: 0.88, trackId: 30 });
    expect(buildCanonicalPersonTracks([sample]).samples[0]!.canonicalPersons).toHaveLength(3);
  });
});
