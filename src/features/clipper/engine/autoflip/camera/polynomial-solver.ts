import type { FocusPointFrame } from "../../types/autoflip";

type Coefficients = [number, number, number, number, number];

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(augmented[row]![pivot]!) > Math.abs(augmented[best]![pivot]!)) best = row;
    }
    if (Math.abs(augmented[best]![pivot]!) < 1e-10) return null;
    [augmented[pivot], augmented[best]] = [augmented[best]!, augmented[pivot]!];
    const divisor = augmented[pivot]![pivot]!;
    for (let column = pivot; column <= n; column++) augmented[pivot]![column]! /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue;
      const factor = augmented[row]![pivot]!;
      for (let column = pivot; column <= n; column++) augmented[row]![column]! -= factor * augmented[pivot]![column]!;
    }
  }
  return augmented.map((row) => row[n]!);
}

function evaluate(coefficients: Coefficients, time: number): number {
  return coefficients[0] * time + coefficients[1] * time ** 2 + coefficients[2] * time ** 3 + coefficients[3] * time ** 4 + coefficients[4];
}

/**
 * Browser equivalent of AutoFlip's Ceres polynomial path solver.  It fits the
 * same fourth-degree curve and approximates Ceres' CauchyLoss(0.5) through
 * deterministic iteratively reweighted least squares.
 */
export function solveAutoFlipPolynomialPath(
  frames: FocusPointFrame[], axis: "x" | "y", outputTimesUs: number[] = frames.map((frame) => frame.timeUs),
  priorFrames: FocusPointFrame[] = [],
): number[] {
  // PolynomialRegressionPathSolver uses the ordinal FocusPointFrame index,
  // not wall-clock time.  This matters for non-integer frame rates and for
  // the 30-frame context carried over after a forced 600-frame flush.
  const allFrames = [...priorFrames, ...frames];
  const observations = allFrames.flatMap((frame, frameIndex) => frame.points.map((point) => ({
    time: frameIndex,
    value: axis === "x" ? point.x : point.y,
  })));
  if (!observations.length) return outputTimesUs.map(() => 0.5);

  let coefficients: Coefficients = [0, 0, 0, 0, observations.reduce((sum, point) => sum + point.value, 0) / observations.length];
  for (let iteration = 0; iteration < 8; iteration++) {
    const normal = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
    const rhs = Array(5).fill(0) as number[];
    for (const point of observations) {
      const residual = point.value - evaluate(coefficients, point.time);
      const robustWeight = 1 / (1 + (residual / 0.5) ** 2);
      const weight = robustWeight;
      const basis = [point.time, point.time ** 2, point.time ** 3, point.time ** 4, 1];
      for (let row = 0; row < 5; row++) {
        rhs[row]! += weight * basis[row]! * point.value;
        for (let column = 0; column < 5; column++) normal[row]![column]! += weight * basis[row]! * basis[column]!;
      }
    }
    // Ceres can solve underdetermined systems; the browser implementation uses
    // a tiny ridge term to retain that behavior for short scenes.
    for (let diagonal = 0; diagonal < 5; diagonal++) normal[diagonal]![diagonal]! += 1e-6;
    const solved = solveLinearSystem(normal, rhs);
    if (!solved) break;
    coefficients = solved as Coefficients;
  }
  return outputTimesUs.map((_, outputIndex) =>
    Math.max(0, Math.min(1, evaluate(coefficients, outputIndex + priorFrames.length))),
  );
}
