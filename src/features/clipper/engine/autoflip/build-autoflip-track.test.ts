import { describe, expect, it } from "vitest";
import type { SubjectDetectionSample } from "../../shared/smart-crop";
import { buildAutoFlipTrack } from "./build-autoflip-track";

const SOLID_BACKGROUND = { r: 24, g: 32, b: 40 };

function personSamples(): SubjectDetectionSample[] {
  return Array.from({ length: 6 }, (_, index) => ({
    time: index * 0.2,
    detections: [
      {
        box: { x: 0.62, y: 0.18, width: 0.18, height: 0.72 },
        label: "person",
        score: 0.9,
      },
    ],
  }));
}

function build(detections: SubjectDetectionSample[]) {
  return buildAutoFlipTrack({
    clipStart: 0,
    clipEnd: 1,
    detections,
    faces: [],
    sceneCuts: [],
    targetAspectRatios: { portrait: 9 / 16 },
    frameWidth: 1920,
    frameHeight: 1080,
    sourceFrameRate: 5,
    hasSolidColorBackground: true,
    solidBackgroundColor: SOLID_BACKGROUND,
    collectDebug: true,
  });
}

describe("buildAutoFlipTrack solid-background policy", () => {
  it("does not emit the removed legacy centroid track layer", () => {
    const track = build(personSamples());
    expect(track).not.toHaveProperty("samples");
    expect(track.aspectTracks!.portrait!.samples.length).toBeGreaterThan(0);
  });

  it("uses salience-driven cropping when a foreground subject is detected", () => {
    const track = build(personSamples());
    const samples = track.aspectTracks!.portrait!.samples;

    expect(samples.every((sample) => sample.crop.width < 1)).toBe(true);
    expect(
      samples.every((sample) => sample.solidBackgroundColor === undefined),
    ).toBe(true);
    expect(track.debug).toHaveLength(1);
    expect(track.debug![0]!.motionType).not.toBe("padding");
  });

  it("preserves padding for a solid scene without foreground salience", () => {
    const track = build([]);
    const samples = track.aspectTracks!.portrait!.samples;

    expect(
      samples.every(
        (sample) => sample.crop.width === 1 && sample.crop.height === 1,
      ),
    ).toBe(true);
    expect(
      samples.every(
        (sample) => sample.solidBackgroundColor === SOLID_BACKGROUND,
      ),
    ).toBe(true);
    expect(track.debug).toHaveLength(1);
    expect(track.debug![0]!.motionType).toBe("padding");
    expect(track.layoutTracks!.portrait!.samples.every((sample) => sample.mode === "contain")).toBe(true);
    expect(track.layoutTracks!.portrait!.samples.every((sample) => sample.viewports[0]!.width === 1)).toBe(true);
    expect(
      track.debug![0]!.keyframes.every(
        (keyframe) => keyframe.chosenRect?.width === 1,
      ),
    ).toBe(true);
  });
});

describe("buildAutoFlipTrack matched-aspect reframing", () => {
  it("keeps the full-frame cover crop for matched-aspect footage", () => {
    const detections: SubjectDetectionSample[] = Array.from({ length: 11 }, (_, index) => ({
      time: index * 0.2,
      detections: [],
      poseSubjects: [{
        box: { x: 0.68, y: 0.15, width: 0.18, height: 0.72 },
        headBox: { x: 0.72, y: 0.16, width: 0.08, height: 0.12 },
        torsoBox: { x: 0.7, y: 0.3, width: 0.14, height: 0.3 },
        score: 0.9,
        trackId: 7,
      }],
    }));
    const track = buildAutoFlipTrack({
      clipStart: 0,
      clipEnd: 2,
      detections,
      faces: [],
      sceneCuts: [],
      targetAspectRatios: { landscape: 16 / 9 },
      frameWidth: 1920,
      frameHeight: 1080,
      sourceFrameRate: 5,
    });
    const samples = track.aspectTracks!.landscape!.samples;
    expect(samples.every((sample) => sample.crop.width >= 0.99)).toBe(true);
  });
});
