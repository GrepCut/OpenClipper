import { describe, expect, it } from "vitest";
import type { EvaluatedParams } from "./replay-sweep";
import { compareByObjective } from "./replay-sweep";

function candidate(overrides: {
  coverageHit: number;
  coverage: number;
  dual?: number;
  worst?: number;
  catastrophic?: string[];
  quality?: number;
}): EvaluatedParams {
  return {
    params: {} as EvaluatedParams["params"],
    overall: {
      coverageHit: overrides.coverageHit,
      coverage: overrides.coverage,
      dualAllCovered: overrides.dual ?? 0.7,
      clipCount: 18,
    },
    perClip: [],
    worstCoverageHitDelta: 0,
    worstCoverageDelta: 0,
    worstClipCoverage: overrides.worst ?? 0.8,
    qualityPenalty: overrides.quality ?? 0,
    catastrophicClips: overrides.catastrophic ?? [],
    regressedClips: [],
    gates: { passed: true, reasons: [] },
  };
}

describe("Run 9 replay objective", () => {
  it("prefers coverage even when coverage hit is much lower", () => {
    const visible = candidate({ coverageHit: 0.2, coverage: 0.96 });
    const focused = candidate({ coverageHit: 0.99, coverage: 0.94 });
    expect(compareByObjective(visible, focused)).toBeLessThan(0);
  });

  it("prioritizes zero catastrophic clips and then the worst clip", () => {
    const catastrophe = candidate({ coverageHit: 1, coverage: 0.99, catastrophic: ["clip"] });
    const safe = candidate({ coverageHit: 0, coverage: 0.9 });
    expect(compareByObjective(safe, catastrophe)).toBeLessThan(0);

    const strongerWorst = candidate({ coverageHit: 0, coverage: 0.94, worst: 0.82 });
    const strongerMean = candidate({ coverageHit: 0, coverage: 0.98, worst: 0.7 });
    expect(compareByObjective(strongerWorst, strongerMean)).toBeLessThan(0);
  });
});
