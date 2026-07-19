import type { TestKeyframe, TestLayoutIntent, TestTarget } from "../types";
import { clampTargetRect, finalizeTargetRect, TARGET_ASPECT } from "./target-geometry";

function cloneTarget(target: TestTarget): TestTarget {
  return { ...target };
}

export function layoutIntentAt(keyframe: TestKeyframe): TestLayoutIntent {
  return keyframe.layoutIntent ?? "crop";
}

/** Holds the previous keyframe intent until the next keyframe changes it. */
export function evaluateLayoutIntent(
  keyframes: TestKeyframe[],
  timestampUs: number,
): TestLayoutIntent {
  if (keyframes.length === 0) return "crop";
  if (timestampUs <= keyframes[0]!.timestampUs) return layoutIntentAt(keyframes[0]!);
  const last = keyframes.at(-1)!;
  if (timestampUs >= last.timestampUs) return layoutIntentAt(last);

  let nextIndex = 1;
  while (nextIndex < keyframes.length && keyframes[nextIndex]!.timestampUs < timestampUs) {
    nextIndex += 1;
  }
  const next = keyframes[nextIndex]!;
  if (next.timestampUs === timestampUs) return layoutIntentAt(next);
  return layoutIntentAt(keyframes[nextIndex - 1]!);
}

function interpolateCropTargets(
  previous: TestKeyframe,
  next: TestKeyframe,
  factor: number,
  sourceWidth?: number,
  sourceHeight?: number,
): TestTarget[] {
  if (layoutIntentAt(next) !== "crop") {
    return previous.targets.map(cloneTarget);
  }
  return previous.targets.map((target) => {
    const targetNext = next.targets.find((candidate) => candidate.slot === target.slot);
    if (!targetNext) return cloneTarget(target);
    if (sourceWidth && sourceHeight) {
      const centerX = target.x + target.width / 2;
      const centerY = target.y + target.height / 2;
      const nextCenterX = targetNext.x + targetNext.width / 2;
      const nextCenterY = targetNext.y + targetNext.height / 2;
      const height = target.height + (targetNext.height - target.height) * factor;
      const width = (height * sourceHeight * TARGET_ASPECT) / sourceWidth;
      return {
        ...target,
        ...finalizeTargetRect({
          ...target,
          x: centerX + (nextCenterX - centerX) * factor - width / 2,
          y: centerY + (nextCenterY - centerY) * factor - height / 2,
          width,
          height,
        }, sourceWidth, sourceHeight),
      };
    }
    return {
      ...target,
      ...clampTargetRect({
        ...target,
        x: target.x + (targetNext.x - target.x) * factor,
        y: target.y + (targetNext.y - target.y) * factor,
        width: target.width + (targetNext.width - target.width) * factor,
        height: target.height + (targetNext.height - target.height) * factor,
      }),
    };
  });
}

function interpolateContainTargets(
  previous: TestKeyframe,
  next: TestKeyframe,
  factor: number,
): TestTarget[] {
  const target = previous.targets[0];
  if (!target) return [];
  const targetNext = layoutIntentAt(next) === "contain" ? next.targets[0] : undefined;
  if (!targetNext) return [cloneTarget(target)];
  return [{
    ...target,
    ...clampTargetRect({
      x: target.x + (targetNext.x - target.x) * factor,
      y: target.y + (targetNext.y - target.y) * factor,
      width: target.width + (targetNext.width - target.width) * factor,
      height: target.height + (targetNext.height - target.height) * factor,
    }),
    slot: 0,
  }];
}

/** Evaluates the manual timeline. Endpoint values are held; target-count changes occur on keyframes. */
export function evaluateGroundTruth(
  keyframes: TestKeyframe[],
  timestampUs: number,
  sourceWidth?: number,
  sourceHeight?: number,
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

  if (evaluateLayoutIntent(keyframes, timestampUs) === "contain") {
    return interpolateContainTargets(previous, next, factor);
  }
  return interpolateCropTargets(previous, next, factor, sourceWidth, sourceHeight);
}

export function normalizeKeyframes(
  keyframes: TestKeyframe[],
  sourceWidth?: number,
  sourceHeight?: number,
): TestKeyframe[] {
  return [...keyframes]
    .map((frame) => {
      const layoutIntent = frame.layoutIntent ?? "crop";
      return {
        ...frame,
        layoutIntent,
        timestampUs: Math.max(0, Math.round(frame.timestampUs)),
        targets: [...frame.targets]
          .sort((a, b) => a.slot - b.slot)
          .map((target, index) => {
            const slot = index as 0 | 1;
            const geometry = layoutIntent === "contain"
              ? clampTargetRect({ ...target, slot })
              : sourceWidth && sourceHeight
                ? finalizeTargetRect({ ...target, slot }, sourceWidth, sourceHeight)
                : clampTargetRect({ ...target, slot });
            return { ...target, ...geometry, slot };
          }),
      };
    })
    .sort((a, b) => a.timestampUs - b.timestampUs);
}
