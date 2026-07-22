import { coveredFraction } from "../../clipper/engine/autoflip/layout";
import type { TestTarget } from "../types";
import type { NormalizedViewport } from "./metrics";

export const TARGET_ASPECT = 9 / 16;
export const COVERAGE_HIT_THRESHOLD = 0.85;
export const ASPECT_TOLERANCE = 0.01;

export function targetBox(target: TestTarget): NormalizedViewport {
  return { x: target.x, y: target.y, width: target.width, height: target.height };
}

export function targetCenter(target: TestTarget): { x: number; y: number } {
  return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
}

export function nominalSizeForAspects(
  sourceAspect: number,
  targetAspect: number,
): { width: number; height: number } {
  return sourceAspect >= targetAspect
    ? { width: targetAspect / sourceAspect, height: 1 }
    : { width: 1, height: sourceAspect / targetAspect };
}

export function nominalSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  return nominalSizeForAspects(sourceWidth / sourceHeight, TARGET_ASPECT);
}

export function defaultContainRect(
  _sourceWidth: number,
  _sourceHeight: number,
): Pick<TestTarget, "x" | "y" | "width" | "height"> {
  const width = 0.9;
  const height = 0.75;
  return clampTargetRect({
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  });
}

export function resizeTargetFree(
  target: Pick<TestTarget, "x" | "y" | "width" | "height">,
  pointer: { x: number; y: number },
): Pick<TestTarget, "x" | "y" | "width" | "height"> {
  const width = Math.max(0.01, pointer.x - target.x);
  const height = Math.max(0.01, pointer.y - target.y);
  return clampTargetRect({ x: target.x, y: target.y, width, height });
}

export function defaultTargetRect(
  sourceWidth: number,
  sourceHeight: number,
  centerX = 0.5,
  centerY = 0.5,
): Pick<TestTarget, "x" | "y" | "width" | "height"> {
  const nominal = nominalSize(sourceWidth, sourceHeight);
  const scale = 0.35;
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  return finalizeTargetRect({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }, sourceWidth, sourceHeight);
}

export function clampTargetRect(
  target: Pick<TestTarget, "x" | "y" | "width" | "height">,
): Pick<TestTarget, "x" | "y" | "width" | "height"> {
  const width = Math.max(0.001, Math.min(1, target.width));
  const height = Math.max(0.001, Math.min(1, target.height));
  return {
    x: Math.max(0, Math.min(1 - width, target.x)),
    y: Math.max(0, Math.min(1 - height, target.y)),
    width,
    height,
  };
}

/** Clamp position and size while preserving 9:16 in source pixel space. */
export function finalizeTargetRect(
  target: Pick<TestTarget, "x" | "y" | "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
): Pick<TestTarget, "x" | "y" | "width" | "height"> {
  let height = Math.max(0.001, target.height);
  let width = (height * sourceHeight * TARGET_ASPECT) / sourceWidth;
  if (width > 1 || height > 1) {
    const scale = Math.min(width > 1 ? 1 / width : 1, height > 1 ? 1 / height : 1);
    width *= scale;
    height *= scale;
  }
  width = Math.max(0.001, width);
  height = Math.max(0.001, height);
  return {
    x: Math.max(0, Math.min(1 - width, target.x)),
    y: Math.max(0, Math.min(1 - height, target.y)),
    width,
    height,
  };
}

export interface NormalizedInset {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Active video area inside an element using object-fit: contain (uniform scale). */
export function videoContentInset(
  elementWidth: number,
  elementHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): NormalizedInset {
  if (elementWidth <= 0 || elementHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const scale = Math.min(elementWidth / sourceWidth, elementHeight / sourceHeight);
  const contentW = sourceWidth * scale;
  const contentH = sourceHeight * scale;
  return {
    x: (elementWidth - contentW) / 2 / elementWidth,
    y: (elementHeight - contentH) / 2 / elementHeight,
    width: contentW / elementWidth,
    height: contentH / elementHeight,
  };
}

export function targetToStagePercent(
  target: Pick<TestTarget, "x" | "y" | "width" | "height">,
  inset: NormalizedInset,
): { left: number; top: number; width: number; height: number } {
  return {
    left: (inset.x + target.x * inset.width) * 100,
    top: (inset.y + target.y * inset.height) * 100,
    width: target.width * inset.width * 100,
    height: target.height * inset.height * 100,
  };
}

export function stageNormToSourceNorm(
  x: number,
  y: number,
  inset: NormalizedInset,
): { x: number; y: number } {
  return {
    x: (x - inset.x) / inset.width,
    y: (y - inset.y) / inset.height,
  };
}

export function aspectRatioInPixels(
  target: Pick<TestTarget, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
): number {
  return (target.width * sourceWidth) / Math.max(1e-9, target.height * sourceHeight);
}

export function isValidTargetAspect(
  target: Pick<TestTarget, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  return Math.abs(aspectRatioInPixels(target, sourceWidth, sourceHeight) - TARGET_ASPECT) <= ASPECT_TOLERANCE;
}

export function coverageOfTarget(viewports: NormalizedViewport[], target: TestTarget): number {
  const box = targetBox(target);
  if (!viewports.length) return 0;
  return Math.max(...viewports.map((viewport) => coveredFraction(viewport, box)));
}

/** Resize from top-left anchor (SE handle) while preserving 9:16 in pixel space. */
export function resizeTargetFromCorner(
  target: Pick<TestTarget, "x" | "y" | "width" | "height">,
  pointer: { x: number; y: number },
  sourceWidth: number,
  sourceHeight: number,
): Pick<TestTarget, "x" | "y" | "width" | "height"> {
  const anchorX = target.x;
  const anchorY = target.y;
  const dragWidth = Math.max(0.01, pointer.x - anchorX);
  const dragHeight = Math.max(0.01, pointer.y - anchorY);
  const widthFromHeight = (dragHeight * sourceHeight * TARGET_ASPECT) / sourceWidth;
  const heightFromWidth = (dragWidth * sourceWidth) / (sourceHeight * TARGET_ASPECT);
  const width = dragWidth / dragHeight > (sourceWidth * TARGET_ASPECT) / (sourceHeight)
    ? dragWidth
    : widthFromHeight;
  const height = dragWidth / dragHeight > (sourceWidth * TARGET_ASPECT) / (sourceHeight)
    ? heightFromWidth
    : dragHeight;
  return finalizeTargetRect({ x: anchorX, y: anchorY, width, height }, sourceWidth, sourceHeight);
}
