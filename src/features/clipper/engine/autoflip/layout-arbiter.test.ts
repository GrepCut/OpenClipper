import { describe, expect, it } from "vitest";
import type { ImportanceRegion, ImportanceRegionSample } from "../../shared/smart-crop";
import {
  DEFAULT_ARBITER_PARAMS,
  decideLayoutStrategy,
  motionTypeAt,
  subjectLifetimeSec,
  type ArbiterParams,
  type ArbiterSampleContext,
} from "./layout-arbiter";

function region(overrides: Partial<ImportanceRegion> = {}): ImportanceRegion {
  const box = overrides.box ?? { x: 0.4, y: 0.2, width: 0.2, height: 0.5 };
  return {
    id: "subject",
    box,
    contentBox: box,
    kind: "person",
    importanceScore: 0.95,
    confidence: 0.9,
    required: true,
    role: "primary",
    sources: ["face"],
    ...overrides,
  };
}

function stableSamples(primary: ImportanceRegion, count = 6): ImportanceRegionSample[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index * 0.2,
    regions: [primary],
  }));
}

function context(
  samples: ImportanceRegionSample[],
  overrides: Partial<ArbiterSampleContext> = {},
): ArbiterSampleContext {
  const index = samples.length - 1;
  const required = samples[index]!.regions.filter((item) => item.required).slice(0, 2);
  return {
    t: samples[index]!.time,
    cut: false,
    explicitPadding: false,
    desiredMode: "single-crop",
    required,
    baselineScore: 0.5,
    semanticScore: 0.7,
    semanticViewports: [{ x: 0.3, y: 0, width: 0.4, height: 1 }],
    importanceSamples: samples,
    importanceIndex: index,
    ...overrides,
  };
}

function decide(ctx: ArbiterSampleContext, params: Partial<ArbiterParams> = {}) {
  return decideLayoutStrategy(ctx, { ...DEFAULT_ARBITER_PARAMS, ...params });
}

describe("layout arbiter", () => {
  it("selects semantic-single for a stable reliable target with sufficient margin", () => {
    const decision = decide(context(stableSamples(region())));
    expect(decision.selectSemantic).toBe(true);
    expect(decision.strategy).toBe("semantic-single");
    expect(decision.reasonCodes).toEqual(["stable-semantic-target", "proposal-margin"]);
  });

  it("accepts a margin exactly at the threshold and rejects just below", () => {
    const samples = stableSamples(region());
    const at = { baselineScore: 0.5, semanticScore: 0.65 };
    expect(decide(context(samples, at), { proposalMargin: 0.15 }).selectSemantic).toBe(true);
    const rejected = decide(context(samples, { baselineScore: 0.5, semanticScore: 0.649 }), { proposalMargin: 0.15 });
    expect(rejected.selectSemantic).toBe(false);
    expect(rejected.reasonCodes).toContain("insufficient-proposal-margin");
  });

  it("vetoes shot boundaries and explicit padding", () => {
    const samples = stableSamples(region());
    expect(decide(context(samples, { cut: true })).reasonCodes).toContain("shot-boundary");
    expect(decide(context(samples, { explicitPadding: true })).reasonCodes).toContain("baseline-padding");
  });

  it("requires primary importance and face confidence at current thresholds", () => {
    const weakImportance = decide(context(stableSamples(region({ importanceScore: 0.89 }))));
    expect(weakImportance.reasonCodes).toContain("insufficient-semantic-evidence");
    const weakFace = decide(context(stableSamples(region({ confidence: 0.81 }))));
    expect(weakFace.reasonCodes).toContain("insufficient-semantic-evidence");
    expect(decide(context(stableSamples(region({ confidence: 0.82 })))).selectSemantic).toBe(true);
  });

  it("accepts a faceless primary through the multi-source path", () => {
    const multi = region({ sources: ["person", "pose"], confidence: 0.75 });
    expect(decide(context(stableSamples(multi))).selectSemantic).toBe(true);
    const single = region({ sources: ["person"], confidence: 0.95 });
    expect(decide(context(stableSamples(single))).reasonCodes).toContain("insufficient-semantic-evidence");
  });

  it("requires the configured number of stable keyframes", () => {
    const short = stableSamples(region(), 4);
    const rejected = decide(context(short));
    expect(rejected.reasonCodes).toContain("unstable-target");
    expect(decide(context(short), { stabilityKeyframes: 4 }).selectSemantic).toBe(true);
  });

  it("tolerates detector dropouts only inside the configured window", () => {
    const primary = region();
    const withGap: ImportanceRegionSample[] = [
      { time: 0, regions: [primary] },
      { time: 0.2, regions: [primary] },
      { time: 0.4, regions: [primary] },
      { time: 0.6, regions: [primary] },
      { time: 0.7, regions: [] },
      { time: 0.8, regions: [primary] },
    ];
    expect(decide(context(withGap)).selectSemantic).toBe(true);
    expect(decide(context(withGap), { dropoutToleranceSec: 0.05 }).reasonCodes).toContain("unstable-target");
  });

  it("keeps split and contain in shadow unless explicitly allowed", () => {
    const two = [
      region({ id: "a", box: { x: 0.05, y: 0.2, width: 0.15, height: 0.5 } }),
      region({ id: "b", role: "secondary", box: { x: 0.75, y: 0.2, width: 0.15, height: 0.5 } }),
    ];
    const samples = stableSamples(region());
    samples[samples.length - 1] = { time: samples.at(-1)!.time, regions: two };
    const splitCtx = context(
      stableSamples(region()).map((sample) => ({ ...sample, regions: two })),
      { desiredMode: "split", semanticViewports: [two[0]!.box, two[1]!.box] },
    );
    expect(decide(splitCtx).selectSemantic).toBe(false);
    expect(decide(splitCtx, { allowSplit: true }).strategy).toBe("semantic-split");
    const containCtx = context(stableSamples(region()), { desiredMode: "contain" });
    expect(decide(containCtx).selectSemantic).toBe(false);
    expect(decide(containCtx, { allowContain: true }).strategy).toBe("semantic-contain");
  });

  it("enforces the content-coverage guard when enabled", () => {
    const primary = region({ contentBox: { x: 0.0, y: 0.2, width: 0.9, height: 0.5 } });
    const ctx = context(stableSamples(primary), {
      semanticViewports: [{ x: 0.3, y: 0, width: 0.3, height: 1 }],
    });
    expect(decide(ctx).selectSemantic).toBe(true);
    const guarded = decide(ctx, { minRequiredContentCoverage: 0.8 });
    expect(guarded.selectSemantic).toBe(false);
    expect(guarded.reasonCodes).toContain("insufficient-content-coverage");
  });

  it("enforces the subject-lifetime guard when enabled", () => {
    const samples = stableSamples(region(), 5);
    expect(decide(context(samples), { minSubjectLifetimeSec: 0.8 }).selectSemantic).toBe(true);
    const guarded = decide(context(samples), { minSubjectLifetimeSec: 1.5 });
    expect(guarded.reasonCodes).toContain("short-subject-lifetime");
  });

  it("enforces the competitor-ratio guard when enabled", () => {
    const primary = region();
    const competitor = region({ id: "rival", required: false, role: "candidate", importanceScore: 0.9 });
    const samples = stableSamples(primary).map((sample) => ({
      ...sample,
      regions: [primary, competitor],
    }));
    expect(decide(context(samples)).selectSemantic).toBe(true);
    const guarded = decide(context(samples), { maxCompetitorImportanceRatio: 0.5 });
    expect(guarded.reasonCodes).toContain("ambiguous-competitor");
  });

  it("applies per-motion-type margin overrides", () => {
    const ctx = context(stableSamples(region()), { baselineScore: 0.65, semanticScore: 0.7, motionType: "tracking" });
    expect(decide(ctx).selectSemantic).toBe(false);
    expect(decide(ctx, { proposalMarginByMotionType: { tracking: 0.03 } }).selectSemantic).toBe(true);
  });

  it("measures subject lifetime across tolerated dropouts but not across cuts", () => {
    const primary = region();
    const samples: ImportanceRegionSample[] = [
      { time: 0, regions: [primary] },
      { time: 0.4, regions: [primary], cut: true },
      { time: 0.8, regions: [primary] },
      { time: 1.0, regions: [] },
      { time: 1.2, regions: [primary] },
    ];
    // The dropout at t=1.0 is tolerated; the cut at t=0.4 stops the scan, so
    // the subject counts as observed since t=0.8.
    expect(subjectLifetimeSec(samples, 4, "subject", DEFAULT_ARBITER_PARAMS)).toBeCloseTo(0.4, 6);
  });

  it("resolves motion type per format and time range", () => {
    const scenes = [
      { formatId: "tiktok", start: 0, end: 2, motionType: "steady" },
      { formatId: "tiktok", start: 2, end: 4, motionType: "tracking" },
      { formatId: "twitter", start: 0, end: 4, motionType: "sweeping" },
    ];
    expect(motionTypeAt(scenes, "tiktok", 1)).toBe("steady");
    expect(motionTypeAt(scenes, "tiktok", 3)).toBe("tracking");
    expect(motionTypeAt(scenes, "twitter", 3)).toBe("sweeping");
    expect(motionTypeAt(undefined, "tiktok", 1)).toBeUndefined();
  });
});
