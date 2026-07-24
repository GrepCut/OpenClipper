import type { KinematicOptions } from "./config.constants";

export function kinematicOptionsForSmooth(): KinematicOptions {
  return {
    minMotionToReframe: 1.2,
    reframeWindow: 0.35,
    updateRateSeconds: 0.35,
    maxUpdateRate: 0.45,
    maxVelocity: 12,
    filteringTimeWindowUs: 500_000,
    meanPeriodUpdateRate: 0.15,
  };
}
