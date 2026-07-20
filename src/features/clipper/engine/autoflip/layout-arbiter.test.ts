import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARBITER_PARAMS,
  RUN10_ARBITER_PARAMS,
  decideLayoutStrategy,
  type ArbiterParams,
  type ArbiterSampleContext,
} from "./layout-arbiter";

function context(overrides: Partial<ArbiterSampleContext> = {}): ArbiterSampleContext {
  return {
    desiredMode: "single-crop",
    baselineScore: 0.5,
    semanticScore: 0.7,
    ...overrides,
  };
}

function decide(ctx: ArbiterSampleContext, params: Partial<ArbiterParams> = {}) {
  return decideLayoutStrategy(ctx, { ...DEFAULT_ARBITER_PARAMS, ...params });
}

describe("layout arbiter", () => {
  it("honors the visibility controller's decision when it reports one", () => {
    const decision = decide(context({ controllerReasonCodes: ["visibility-widen"] }));
    expect(decision.selectSemantic).toBe(true);
    expect(decision.strategy).toBe("semantic-single");
    expect(decision.reasonCodes).toEqual(["visibility-controller", "visibility-widen"]);
  });

  it("falls back to the baseline when the controller made no decision", () => {
    const decision = decide(context());
    expect(decision.selectSemantic).toBe(false);
    expect(decision.strategy).toBe("legacy-baseline");
    expect(decision.reasonCodes).toEqual(["no-controller-decision"]);
  });

  it("resolves the right strategy per desired mode", () => {
    expect(decide(context({ desiredMode: "split", controllerReasonCodes: ["x"] }), {
      allowSplit: true,
    }).strategy).toBe("semantic-split");
    expect(decide(context({ desiredMode: "contain", controllerReasonCodes: ["x"] }), {
      allowContain: true,
    }).strategy).toBe("semantic-contain");
  });

  it("falls back to the baseline when the mode is not allowed, even with a controller decision", () => {
    const decision = decide(context({ desiredMode: "split", controllerReasonCodes: ["visibility-widen"] }));
    expect(decision.selectSemantic).toBe(false);
    expect(decision.strategy).toBe("legacy-baseline");
    expect(decision.reasonCodes).toEqual(["mode-not-allowed"]);
  });

  it("allows split and contain under RUN10_ARBITER_PARAMS", () => {
    expect(decide(context({ desiredMode: "split", controllerReasonCodes: ["x"] }), RUN10_ARBITER_PARAMS).selectSemantic).toBe(true);
    expect(decide(context({ desiredMode: "contain", controllerReasonCodes: ["x"] }), RUN10_ARBITER_PARAMS).selectSemantic).toBe(true);
  });

  it("ignores cut/explicit-padding style vetoes once the controller has decided", () => {
    // The visibility controller already resets to single-crop across cuts
    // (see planVisibilityRescue); the arbiter has no separate veto for that.
    const decision = decide(context({ controllerReasonCodes: ["run9-shot-boundary"] }));
    expect(decision.selectSemantic).toBe(true);
  });

  it("scores decisionConfidence from the semantic/baseline score gap, clamped to [0, 1]", () => {
    const noGap = decide(context({ baselineScore: 0.5, semanticScore: 0.5, controllerReasonCodes: ["x"] }));
    expect(noGap.decisionConfidence).toBe(0);
    const partialGap = decide(context({ baselineScore: 0.5, semanticScore: 0.65, controllerReasonCodes: ["x"] }), {
      decisionConfidenceScale: 0.3,
    });
    expect(partialGap.decisionConfidence).toBeCloseTo(0.5, 6);
    const negativeGap = decide(context({ baselineScore: 0.9, semanticScore: 0.1, controllerReasonCodes: ["x"] }));
    expect(negativeGap.decisionConfidence).toBe(0);
    const fullGap = decide(context({ baselineScore: 0, semanticScore: 1, controllerReasonCodes: ["x"] }), {
      decisionConfidenceScale: 0.3,
    });
    expect(fullGap.decisionConfidence).toBe(1);
  });
});
