import { describe, expect, it } from "vitest";
import type { ImportanceRegion, ImportanceRegionSample } from "../../shared/smart-crop";
import {
  createVisibilityControllerState,
  ITERATION10_VISIBILITY_CONTROLLER_PARAMS,
  planVisibilityRescue,
  RUN9_VISIBILITY_CONTROLLER_PARAMS,
} from "./visibility-controller";

function person(id: string, x: number, role: ImportanceRegion["role"]): ImportanceRegion {
  const box = { x, y: 0.2, width: 0.12, height: 0.55 };
  return {
    id,
    box,
    contentBox: box,
    kind: "person",
    importanceScore: role === "primary" ? 0.96 : 0.85,
    confidence: 0.92,
    required: true,
    role,
    sources: ["person", "pose"],
  };
}

const baseline = { x: 0.34, y: 0, width: 0.31640625, height: 1 };

function decide(samples: ImportanceRegionSample[], index: number) {
  return planVisibilityRescue({
    samples,
    importanceIndex: index,
    baselineViewport: baseline,
    sourceAspect: 16 / 9,
    targetAspect: 9 / 16,
    state: createVisibilityControllerState(),
    params: { ...RUN9_VISIBILITY_CONTROLLER_PARAMS },
  });
}

describe("Run 9 visibility controller", () => {
  it("pre-shifts a crop using same-scene lookahead before the target leaves the baseline", () => {
    const samples: ImportanceRegionSample[] = [
      { time: 0, regions: [person("a", 0.48, "primary")] },
      { time: 0.2, regions: [person("a", 0.55, "primary")] },
      { time: 0.4, regions: [person("a", 0.6, "primary")] },
    ];
    const result = decide(samples, 0);
    expect(result.mode).toBe("single-crop");
    expect(result.reasonCodes).toContain("visibility-shift");
    expect(result.selectedCoverage[0]).toBeCloseTo(1, 6);
    expect(result.viewports[0]!.x).toBeGreaterThan(baseline.x);
  });

  it("selects a stable split for two independently evidenced distant people", () => {
    const samples = Array.from({ length: 3 }, (_, index): ImportanceRegionSample => ({
      time: index * 0.2,
      regions: [person("left", 0.04, "primary"), person("right", 0.82, "secondary")],
    }));
    const result = decide(samples, 2);
    expect(result.mode).toBe("split");
    expect(result.reasonCodes).toContain("stable-split-v2");
    expect(result.viewports).toHaveLength(2);
    expect(result.selectedCoverage.every((value) => value > 0.99)).toBe(true);
  });

  it("does not carry lookahead across a scene cut", () => {
    const samples: ImportanceRegionSample[] = [
      { time: 0, regions: [person("a", 0.48, "primary")] },
      { time: 0.2, cut: true, regions: [person("b", 0.84, "primary")] },
    ];
    const result = decide(samples, 0);
    expect(result.envelopes[0]!.contentBox.x).toBeLessThan(0.5);
    expect(result.reasonCodes).toEqual(["run8-safe-margin"]);
  });

  it("keeps predicted-only evidence on the Run 8 fallback", () => {
    const predicted = { ...person("a", 0.8, "primary"), predicted: true };
    const result = decide([{ time: 0, regions: [predicted] }], 0);
    expect(result.viewports).toEqual([baseline]);
    expect(result.reasonCodes).toContain("run8-fallback");
  });
});

describe("Iteration 10 split state machine", () => {
  it("requires 0.6 s pending and keeps panel order by canonical id", () => {
    const samples = Array.from({ length: 12 }, (_, index): ImportanceRegionSample => ({
      time: index * 0.2,
      regions: [
        person("canonical-person:1", index < 8 ? 0.04 : 0.82, "primary"),
        person("canonical-person:2", index < 8 ? 0.82 : 0.04, "secondary"),
      ],
    }));
    const state = createVisibilityControllerState();
    const modes = samples.map((_, index) => planVisibilityRescue({
      samples,
      importanceIndex: index,
      baselineViewport: baseline,
      sourceAspect: 16 / 9,
      targetAspect: 9 / 16,
      state,
      params: { ...ITERATION10_VISIBILITY_CONTROLLER_PARAMS },
    }));
    const firstSplit = modes.findIndex((result) => result.mode === "split");
    expect(firstSplit).toBeGreaterThanOrEqual(5);
    expect(modes[firstSplit]!.reasonCodes).toContain("stable-split-v3");
    expect(state.panelOrder).toEqual(["canonical-person:1", "canonical-person:2"]);
  });

  it("never creates an arbitrary split for three similarly important people", () => {
    const samples = Array.from({ length: 7 }, (_, index): ImportanceRegionSample => ({
      time: index * 0.2,
      regions: [
        person("a", 0.02, "primary"),
        person("b", 0.44, "secondary"),
        { ...person("c", 0.84, "secondary"), required: false, role: "candidate" },
      ],
    }));
    const state = createVisibilityControllerState();
    const result = samples.map((_, index) => planVisibilityRescue({
      samples, importanceIndex: index, baselineViewport: baseline, sourceAspect: 16 / 9,
      targetAspect: 9 / 16, state, params: { ...ITERATION10_VISIBILITY_CONTROLLER_PARAMS },
    })).at(-1)!;
    expect(result.mode).not.toBe("split");
  });
});
