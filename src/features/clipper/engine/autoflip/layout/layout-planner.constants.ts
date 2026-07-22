import type { SemanticFramingParams } from "../../types/autoflip-layout.types";

/** Promoted framing geometry. Values are global and clip-agnostic. */
export const DEFAULT_SEMANTIC_FRAMING_PARAMS: SemanticFramingParams = {
  targetBoxSource: "contentBox",
  centerYFraction: 0.44,
  padding: 0.18,
  minimumScale: 0.5,
};

export const VISIBILITY_CONSTRAINED_FRAMING_PARAMS: SemanticFramingParams = {
  targetBoxSource: "box",
  centerYFraction: 0.44,
  padding: 0.08,
  minimumScale: 0.8,
  visibilityConstrained: true,
  visibilityGuardMargin: 0.08,
  stablePrimaryKeyframes: 5,
  allowedScales: [1, 0.95, 0.9, 0.8],
  scaleHysteresis: 0.025,
  maxCenterStep: 0.08,
  maxScaleStep: 0.05,
};
