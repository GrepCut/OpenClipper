import { describe, expect, it } from "vitest";
import { analyzeSceneMotion, computeSalienceZoomScale } from "./scene-camera-motion";
import type { KeyFrameSalientInput, SalientRegion } from "./types";
import { AUTOFLIP_MIN_ZOOM_SCALE } from "./types";

const FRAME_W = 1920;
const FRAME_H = 1080;
const PORTRAIT = 9 / 16;

function faceRegion(x: number, y: number, size = 0.06): SalientRegion {
  return {
    box: { x: x - size / 2, y: y - size / 2, width: size, height: size },
    score: 0.88,
    signalType: "face_core",
    isRequired: false,
  };
}

function humanRegion(x: number, y: number, width: number, height: number): SalientRegion {
  return {
    box: { x: x - width / 2, y: y - height / 2, width, height },
    score: 0.78,
    signalType: "human",
    isRequired: false,
  };
}

function keyframesWith(regions: SalientRegion[], count = 10): KeyFrameSalientInput[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index * 0.2,
    regions: regions.map((region) => ({ ...region, box: { ...region.box } })),
    isShotChange: false,
  }));
}

describe("computeSalienceZoomScale", () => {
  it("shrinks toward the floor for a small face", () => {
    const scale = computeSalienceZoomScale({
      keyframes: keyframesWith([faceRegion(0.5, 0.3)]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
      margin: 3.6,
      minScale: AUTOFLIP_MIN_ZOOM_SCALE,
    });
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(AUTOFLIP_MIN_ZOOM_SCALE);
  });

  it("keeps the full window when the focus band spans the frame", () => {
    const scale = computeSalienceZoomScale({
      keyframes: keyframesWith([faceRegion(0.1, 0.5), faceRegion(0.9, 0.5)]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
      margin: 3.6,
      minScale: AUTOFLIP_MIN_ZOOM_SCALE,
    });
    expect(scale).toBe(1);
  });

  it("returns 1 when no keyframe has salience", () => {
    const scale = computeSalienceZoomScale({
      keyframes: keyframesWith([]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
      margin: 3.6,
      minScale: AUTOFLIP_MIN_ZOOM_SCALE,
    });
    expect(scale).toBe(1);
  });
});

describe("analyzeSceneMotion with cropScale", () => {
  it("keeps the classic full-height cover crop at scale 1", () => {
    const motion = analyzeSceneMotion({
      keyframes: keyframesWith([faceRegion(0.5, 0.3), humanRegion(0.5, 0.55, 0.25, 0.9)]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
    });
    expect(motion.summary.cropWindowHeight).toBeCloseTo(FRAME_H, 0);
  });

  it("shrinks the window and tracks the face vertically when zoomed", () => {
    const motion = analyzeSceneMotion({
      keyframes: keyframesWith([faceRegion(0.5, 0.3), humanRegion(0.5, 0.55, 0.25, 0.9)]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
      cropScale: AUTOFLIP_MIN_ZOOM_SCALE,
    });
    expect(motion.summary.cropWindowHeight).toBeLessThan(FRAME_H * 0.75);
    // Steady scene: the look-at centre must sit near the face, not the torso.
    expect(motion.summary.lookAtCenterY).toBeLessThan(0.45);
    // A shrunk window emits real (single) focus points, freeing the y solver.
    const focusPoints = motion.focusPointFrames.flatMap((frame) => frame.points);
    expect(focusPoints.every((point) => point.y > 0 && point.y < 1)).toBe(true);
  });

  it("never shrinks the window below the focus band", () => {
    const bigFacePair = [faceRegion(0.2, 0.5, 0.1), faceRegion(0.8, 0.5, 0.1)];
    const motion = analyzeSceneMotion({
      keyframes: keyframesWith(bigFacePair),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
      cropScale: AUTOFLIP_MIN_ZOOM_SCALE,
    });
    // The two faces span ~0.7 of the width; the window must still cover them.
    expect(motion.summary.cropWindowWidth / FRAME_W).toBeGreaterThanOrEqual(0.69);
  });

  it("recenters keyframe crops on the focus band instead of the union", () => {
    const motion = analyzeSceneMotion({
      keyframes: keyframesWith([faceRegion(0.3, 0.3), { ...humanRegion(0.4, 0.55, 0.3, 0.85) }]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
      cropScale: 0.7,
    });
    for (const crop of motion.keyframeCrops) {
      const centerY = crop.rect.y + crop.rect.height / 2;
      // Union centre would sit near 0.5; the face-band weighting pulls it up.
      expect(centerY).toBeLessThan(0.47);
    }
  });
});

describe("analyzeSceneMotion bounded sweeping", () => {
  it("sweeps only between observed salient centers", () => {
    const keyframes = Array.from({ length: 10 }, (_, index): KeyFrameSalientInput => {
      const offset = index < 5 ? 0 : 0.1;
      return {
        time: index * 0.2,
        regions: [0.05, 0.45, 0.85].map((x) => faceRegion(x + offset, 0.4)),
        isShotChange: false,
      };
    });
    const motion = analyzeSceneMotion({
      keyframes,
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
    });

    expect(motion.summary.motionType).toBe("sweeping");
    const centers = motion.focusPointFrames.map((frame) => frame.points[0]!.x);
    expect(Math.min(...centers)).toBeGreaterThan(0.35);
    expect(Math.max(...centers)).toBeLessThan(0.7);
  });

  it("falls back to a steady crop when salient centers have no travel", () => {
    const motion = analyzeSceneMotion({
      keyframes: keyframesWith([faceRegion(0.05, 0.4), faceRegion(0.45, 0.4), faceRegion(0.85, 0.4)]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
    });

    expect(motion.summary.motionType).toBe("steady");
    expect(new Set(motion.focusPointFrames.map((frame) => frame.points[0]!.x)).size).toBe(1);
  });

  it("keeps no-salience scenes centered", () => {
    const motion = analyzeSceneMotion({
      keyframes: keyframesWith([]),
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      targetAspectRatio: PORTRAIT,
    });

    expect(motion.summary.motionType).toBe("steady");
    expect(motion.focusPointFrames.every((frame) => frame.points.every((point) => point.x === 0.5))).toBe(true);
  });
});
