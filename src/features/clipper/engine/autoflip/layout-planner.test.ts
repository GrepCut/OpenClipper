import { describe, expect, it } from "vitest";
import type { AutoFlipAspectTrack, ImportanceRegion, ImportanceRegionSample } from "../../shared/smart-crop";
import { buildLayoutTracks, layoutGeometry } from "./layout-planner";

function importance(
  id: string,
  x: number,
  width: number,
  role: ImportanceRegion["role"],
  kind: ImportanceRegion["kind"] = "person",
): ImportanceRegion {
  const box = { x, y: 0.2, width, height: 0.45 };
  return {
    id,
    box,
    contentBox: box,
    kind,
    importanceScore: role === "primary" ? 0.95 : 0.8,
    confidence: 0.95,
    required: role !== "candidate",
    role,
    sources: kind === "face" ? ["face"] : ["person", "pose"],
  };
}

function aspectTrack(): AutoFlipAspectTrack {
  return {
    targetAspectRatio: 9 / 16,
    samples: Array.from({ length: 4 }, (_, index) => ({
      t: index * 0.2,
      crop: { x: 0.34, y: 0, width: 0.31640625, height: 1 },
    })),
  };
}

function build(samples: ImportanceRegionSample[]) {
  const stableSamples = samples.length === 1
    ? Array.from({ length: 6 }, (_, index) => ({ ...samples[0]!, time: index * 0.12 }))
    : samples;
  return buildLayoutTracks({
    aspectTracks: { tiktok: aspectTrack() },
    importanceSamples: stableSamples,
    frameWidth: 1920,
    frameHeight: 1080,
  }).tiktok!;
}

describe("layout planner", () => {
  it("keeps a split proposal in shadow until it beats the Run4 collage baseline", () => {
    const track = build([{ time: 0, regions: [importance("a", 0.02, 0.18, "primary"), importance("b", 0.78, 0.18, "secondary")] }]);
    expect(track.samples[0]!.strategy).toBe("legacy-baseline");
    expect(track.samples.at(-1)!.strategy).toBe("legacy-baseline");
    expect(track.samples.at(-1)!.candidateMode).toBe("split");
    expect(track.samples.at(-1)!.candidateViewports).toHaveLength(2);
  });

  it("keeps a contain proposal in shadow until it beats the Run4 contain baseline", () => {
    const track = build([{ time: 0, regions: [importance("action", 0.08, 0.82, "primary", "action")] }]);
    expect(track.samples.at(-1)!.strategy).toBe("legacy-baseline");
    expect(track.samples.at(-1)!.candidateMode).toBe("contain");
    expect(track.samples.at(-1)!.candidateViewports).toHaveLength(1);
  });

  it("keeps single crops aspect-locked in source pixels", () => {
    const sourceAspect = 16 / 9;
    const viewport = layoutGeometry.strictAspectViewport(
      { x: 0.2, y: 0.1, width: 0.5, height: 0.7 },
      sourceAspect,
      9 / 16,
    );
    expect((viewport.width * 1920) / (viewport.height * 1080)).toBeCloseTo(9 / 16, 6);
  });

  it("recenters the stable legacy zoom on the selected primary target", () => {
    const track = build([{ time: 0, regions: [importance("primary", 0.72, 0.12, "primary", "face")] }]);
    const viewport = track.samples.at(-1)!.viewports[0]!;
    const targetCenter = 0.72 + 0.12 / 2;
    expect(viewport.x + viewport.width / 2).toBeCloseTo(targetCenter, 6);
    expect((viewport.width * 1920) / (viewport.height * 1080)).toBeCloseTo(9 / 16, 6);
  });

  it("keeps the Run4 baseline when semantic evidence is not stable", () => {
    const track = buildLayoutTracks({
      aspectTracks: { tiktok: aspectTrack() },
      importanceSamples: [{ time: 0, regions: [importance("flash", 0.72, 0.12, "primary", "face")] }],
      frameWidth: 1920,
      frameHeight: 1080,
    }).tiktok!;
    expect(track.samples.every((sample) => sample.strategy === "legacy-baseline")).toBe(true);
  });
});
