import { describe, expect, it } from "vitest";
import type { EvaluatedParams } from "./replay-sweep";
import { compareByObjective } from "./replay-sweep";

function candidate(overrides: {
  focus: number;
  visibility: number;
  dual?: number;
  worst?: number;
  catastrophic?: string[];
  quality?: number;
}): EvaluatedParams {
  return {
    params: {} as EvaluatedParams["params"],
    overall: {
      focusHit: overrides.focus,
      visibility: overrides.visibility,
      dualAllVisible: overrides.dual ?? 0.7,
      clipCount: 18,
    },
    perClip: [],
    worstFocusDelta: 0,
    worstVisibilityDelta: 0,
    worstClipVisibility: overrides.worst ?? 0.8,
    qualityPenalty: overrides.quality ?? 0,
    catastrophicClips: overrides.catastrophic ?? [],
    regressedClips: [],
    gates: { passed: true, reasons: [] },
  };
}

describe("Run 9 replay objective", () => {
  it("prefers visibility even when focus is much lower", () => {
    const visible = candidate({ focus: 0.2, visibility: 0.96 });
    const focused = candidate({ focus: 0.99, visibility: 0.94 });
    expect(compareByObjective(visible, focused)).toBeLessThan(0);
  });

  it("prioritizes zero catastrophic clips and then the worst clip", () => {
    const catastrophe = candidate({ focus: 1, visibility: 0.99, catastrophic: ["clip"] });
    const safe = candidate({ focus: 0, visibility: 0.9 });
    expect(compareByObjective(safe, catastrophe)).toBeLessThan(0);

    const strongerWorst = candidate({ focus: 0, visibility: 0.94, worst: 0.82 });
    const strongerMean = candidate({ focus: 0, visibility: 0.98, worst: 0.7 });
    expect(compareByObjective(strongerWorst, strongerMean)).toBeLessThan(0);
  });
});
