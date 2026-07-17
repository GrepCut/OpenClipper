import type { TestKeyframe, TestTarget } from "../types";

function cloneTarget(target: TestTarget): TestTarget {
  return { ...target };
}

/** Evaluates the manual timeline. Endpoint values are held; target-count changes occur on keyframes. */
export function evaluateGroundTruth(
  keyframes: TestKeyframe[],
  timestampUs: number,
): TestTarget[] {
  if (keyframes.length === 0) return [];
  if (timestampUs <= keyframes[0]!.timestampUs) {
    return keyframes[0]!.targets.map(cloneTarget);
  }
  const last = keyframes.at(-1)!;
  if (timestampUs >= last.timestampUs) return last.targets.map(cloneTarget);

  let nextIndex = 1;
  while (nextIndex < keyframes.length && keyframes[nextIndex]!.timestampUs < timestampUs) {
    nextIndex += 1;
  }
  const next = keyframes[nextIndex]!;
  if (next.timestampUs === timestampUs) return next.targets.map(cloneTarget);
  const previous = keyframes[nextIndex - 1]!;
  const factor = (timestampUs - previous.timestampUs) /
    Math.max(1, next.timestampUs - previous.timestampUs);

  // The preceding keyframe controls which targets are required until the
  // next keyframe. A slot present on both sides receives linear interpolation.
  return previous.targets.map((target) => {
    const targetNext = next.targets.find((candidate) => candidate.slot === target.slot);
    if (!targetNext) return cloneTarget(target);
    return {
      ...target,
      x: target.x + (targetNext.x - target.x) * factor,
      y: target.y + (targetNext.y - target.y) * factor,
      radius: target.radius + (targetNext.radius - target.radius) * factor,
    };
  });
}

export function normalizeKeyframes(keyframes: TestKeyframe[]): TestKeyframe[] {
  return [...keyframes]
    .map((frame) => ({
      ...frame,
      timestampUs: Math.max(0, Math.round(frame.timestampUs)),
      targets: [...frame.targets]
        .sort((a, b) => a.slot - b.slot)
        .map((target, index) => ({
          ...target,
          slot: index as 0 | 1,
          x: Math.max(0, Math.min(1, target.x)),
          y: Math.max(0, Math.min(1, target.y)),
          radius: Math.max(0.001, target.radius),
        })),
    }))
    .sort((a, b) => a.timestampUs - b.timestampUs);
}
