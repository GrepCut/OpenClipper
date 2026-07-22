import { describe, expect, it } from "vitest";
import type { FaceBoxSample } from "../../../shared/face-samples";

// reframe.ts also owns native analysis helpers whose dispatcher is installed
// at module load. The production runtime always has Window; provide the
// minimal equivalent before dynamically importing the pure collage engine.
(globalThis as typeof globalThis & { window: typeof globalThis }).window = globalThis;

const {
  deriveCollageAspectEligibility,
  deriveTwoSpeakerRegions,
  facesFitSingleCrop,
  filterRegionsWithEligibleAspects,
  overlapFractionOfSmaller,
  selectDominantFacePair,
} = await import("./track");

const FRAME_W = 1920;
const FRAME_H = 1080;

function face(x: number, width = 120, y = 260, height = 120) {
  return { x, y, width, height };
}

function sample(time: number, faces = [face(500), face(1300)], sceneCut = false): FaceBoxSample {
  return { time, faces, frameW: FRAME_W, frameH: FRAME_H, sceneCut: sceneCut || undefined };
}

describe("two-speaker collage detection", () => {
  it("opens after two samples and tolerates brief detection loss", () => {
    const regions = deriveTwoSpeakerRegions([
      sample(0),
      sample(0.5),
      sample(1, []),
      sample(1.5),
    ]);

    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ start: 0, end: 1.5 });
  });

  it("closes at a sustained three-sample loss and resets at a scene cut", () => {
    const lost = deriveTwoSpeakerRegions([
      sample(0),
      sample(0.5),
      sample(1, []),
      sample(1.5, []),
      sample(2, []),
    ]);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.end).toBe(1);

    const cut = deriveTwoSpeakerRegions([
      sample(0),
      sample(0.5),
      sample(1, [face(500), face(1300)], true),
      sample(1.5),
    ]);
    expect(cut.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 0.5 },
      { start: 1, end: 1.5 },
    ]);
  });

  it("rejects duplicate detections and an ambiguous third face", () => {
    const duplicate = [face(400, 180), face(420, 120)];
    expect(overlapFractionOfSmaller(duplicate[0]!, duplicate[1]!)).toBeGreaterThan(0.5);
    expect(selectDominantFacePair(duplicate)).toBeNull();

    expect(selectDominantFacePair([face(300), face(900), face(1450, 100)])).toBeNull();
    expect(selectDominantFacePair([face(300), face(900), face(1450, 50)])).not.toBeNull();
  });
});

describe("format-aware collage eligibility", () => {
  it("uses distinct two-person panel crops even when both faces fit the nominal frame", () => {
    const samples = [sample(0), sample(0.5), sample(1)];
    const pair = selectDominantFacePair(samples[0]!.faces)!;
    expect(facesFitSingleCrop(pair, FRAME_W, FRAME_H, 1)).toBe(true);
    expect(facesFitSingleCrop(pair, FRAME_W, FRAME_H, 9 / 16)).toBe(false);

    const regions = deriveTwoSpeakerRegions(samples);
    const eligibility = deriveCollageAspectEligibility(samples, regions, "normal");
    expect(eligibility["9-16"]).toHaveLength(1);
    expect(eligibility["1-1"]).toHaveLength(1);
    expect(eligibility["16-9"]).toHaveLength(1);
    expect(filterRegionsWithEligibleAspects(regions, eligibility, ["9-16"])).toEqual(regions);
    expect(filterRegionsWithEligibleAspects(regions, eligibility, ["1-1"])).toEqual(regions);
  });

  it("rejects split when the two panel crops would mostly show the same area", () => {
    const closeLargeFaces = [face(600, 350, 220, 350), face(1000, 350, 220, 350)];
    const samples = [sample(0, closeLargeFaces), sample(0.5, closeLargeFaces), sample(1, closeLargeFaces)];
    const regions = deriveTwoSpeakerRegions(samples);
    const eligibility = deriveCollageAspectEligibility(samples, regions, "normal");

    expect(regions).toHaveLength(1);
    expect(eligibility["9-16"]).toHaveLength(0);
  });
});
