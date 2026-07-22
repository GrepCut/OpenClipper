import type { ClipperSmoothingStrength } from "../../../settings/settings.util";
import type { KinematicOptions } from "./config.constants";

export function kinematicOptionsForSmoothing(strength: ClipperSmoothingStrength): KinematicOptions {
  switch (strength) {
    case "smooth":
      return {
        minMotionToReframe: 1.2,
        reframeWindow: 0.35,
        updateRateSeconds: 0.35,
        maxUpdateRate: 0.45,
        maxVelocity: 12,
        filteringTimeWindowUs: 500_000,
        meanPeriodUpdateRate: 0.15,
      };
    case "snappy":
      return {
        minMotionToReframe: 0.6,
        reframeWindow: 0.15,
        updateRateSeconds: 0.08,
        maxUpdateRate: 0.95,
        maxVelocity: 36,
        filteringTimeWindowUs: 0,
        meanPeriodUpdateRate: 0.45,
      };
    case "balanced":
    default:
      return {
        minMotionToReframe: 0.9,
        reframeWindow: 0.25,
        updateRateSeconds: 0.2,
        maxUpdateRate: 0.8,
        maxVelocity: 18,
        filteringTimeWindowUs: 200_000,
        meanPeriodUpdateRate: 0.25,
      };
  }
}
