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
    expect(
      track.debug![0]!.keyframes.every(
        (keyframe) => keyframe.chosenRect?.width === 1,
      ),
    ).toBe(true);
  });
});
