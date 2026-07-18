import type { TestKeyframe, TestTarget } from "../types";
import { evaluateGroundTruth } from "./ground-truth";
import { calculateBenchmarkMetrics, type BenchmarkFrameInput, type NormalizedViewport } from "./metrics";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nominalSize(sourceAspect: number, targetAspect: number): { width: number; height: number } {
  return sourceAspect >= targetAspect
    ? { width: targetAspect / sourceAspect, height: 1 }
    : { width: 1, height: sourceAspect / targetAspect };
}

function centeredViewport(
  targets: TestTarget[],
  sourceAspect: number,
  targetAspect: number,
  scale = 1,
): NormalizedViewport {
  const nominal = nominalSize(sourceAspect, targetAspect);
  const size = { width: nominal.width * scale, height: nominal.height * scale };
  const centerX = targets.reduce((sum, target) => sum + target.x, 0) / Math.max(1, targets.length);
  const centerY = targets.reduce((sum, target) => sum + target.y, 0) / Math.max(1, targets.length);
  return {
    x: clamp(centerX - size.width / 2, 0, 1 - size.width),
    y: clamp(centerY - size.height / 2, 0, 1 - size.height),
    ...size,
  };
}

function framesForPolicy(input: {
  timestampsSec: number[];
  keyframes: TestKeyframe[];
  sourceWidth: number;
  sourceHeight: number;
  targetAspectRatio: number;
  splitDualTargets: boolean;
}): BenchmarkFrameInput[] {
  const sourceAspect = input.sourceWidth / input.sourceHeight;
  return input.timestampsSec.map((time) => {
    const timestampUs = Math.round(time * 1_000_000);
    const targets = evaluateGroundTruth(input.keyframes, timestampUs);
    const split = input.splitDualTargets && targets.length === 2;
    const viewports = split
      ? targets.map((target) => centeredViewport([target], sourceAspect, input.targetAspectRatio * 2, 0.1))
      : [centeredViewport(targets, sourceAspect, input.targetAspectRatio)];
    return { timestampUs, viewports, layoutMode: split ? "split" : "single-crop" };
  });
}

/** Geometry-only diagnostic ceiling. It is never used to build production tracks. */
export function calculateLayoutOracle(input: {
  timestampsSec: number[];
  keyframes: TestKeyframe[];
  sourceWidth: number;
  sourceHeight: number;
  targetAspectRatio: number;
}) {
  const evaluate = (splitDualTargets: boolean) => calculateBenchmarkMetrics({
    keyframes: input.keyframes,
    frames: framesForPolicy({ ...input, splitDualTargets }),
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
  }).metrics;
  return {
    singleCrop: evaluate(false),
    autoSplit: evaluate(true),
  };
}
