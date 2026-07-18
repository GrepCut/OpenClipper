import { describe, expect, it } from "vitest";
import { syntheticHeadRegions } from "./salient-region";
import type { AutoFlipFaceDetection, SubjectDetection } from "../../shared/smart-crop";

const person: SubjectDetection = {
  box: { x: 0.2, y: 0.1, width: 0.25, height: 0.8 },
  label: "person",
  score: 0.9,
  trackId: 7,
};

describe("syntheticHeadRegions", () => {
  it("emits a face_full head band for a person with no detected face", () => {
    const regions = syntheticHeadRegions([person], []);
    expect(regions).toHaveLength(1);
    const head = regions[0]!;
    expect(head.signalType).toBe("face_full");
    // Head band sits at the top of the person box, horizontally centred.
    expect(head.box.y).toBeCloseTo(0.1, 5);
    expect(head.box.height).toBeCloseTo(0.8 * 0.22, 5);
    expect(head.box.x).toBeGreaterThan(person.box.x);
    // Stays below a real face detection's score band.
    expect(head.score).toBeLessThan(0.85);
  });

  it("emits nothing when a detected face already overlaps the head band", () => {
    const face: AutoFlipFaceDetection = {
      box: { x: 0.28, y: 0.12, width: 0.08, height: 0.1 },
      keypoints: [],
    };
    expect(syntheticHeadRegions([person], [face])).toHaveLength(0);
  });

  it("ignores predicted and low-confidence detections and non-humans", () => {
    expect(syntheticHeadRegions([{ ...person, predicted: true }], [])).toHaveLength(0);
    expect(syntheticHeadRegions([{ ...person, score: 0.3 }], [])).toHaveLength(0);
    expect(syntheticHeadRegions([{ ...person, label: "car" }], [])).toHaveLength(0);
  });
});
