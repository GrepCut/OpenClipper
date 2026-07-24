import { clamp } from "../../../lib/math.util";
import type { NormalizedBox } from "../../../shared/smart-crop.util";
import { importanceGeometry } from "../salience/importance-ranker.util";

const EPSILON = 1e-9;

/**
 * A split should show two distinct views, not the same subject twice.  The
 * fraction is measured against the smaller viewport so containment is also
 * treated as a full overlap.
 */
export const MAX_SPLIT_VIEWPORT_OVERLAP = 0.2;

export function splitViewportsAreDistinct(viewports: NormalizedBox[]): boolean {
  return viewports.every((viewport, index) =>
    viewports.slice(index + 1).every((other) =>
      importanceGeometry.overlapFractionOfSmaller(viewport, other) <= MAX_SPLIT_VIEWPORT_OVERLAP,
    ));
}

export function unionAll(boxes: NormalizedBox[]): NormalizedBox | null {
  return boxes.reduce<NormalizedBox | null>(
    (result, box) => result ? importanceGeometry.unionBoxes(result, box) : { ...box },
    null,
  );
}

export function expandBox(box: NormalizedBox, margin: number): NormalizedBox {
  const x = clamp(box.x - box.width * margin, 0, 1);
  const y = clamp(box.y - box.height * margin, 0, 1);
  const right = clamp(box.x + box.width * (1 + margin), 0, 1);
  const bottom = clamp(box.y + box.height * (1 + margin), 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

export function nominalCropSize(sourceAspect: number, targetAspect: number): { width: number; height: number } {
  if (sourceAspect >= targetAspect) return { width: targetAspect / sourceAspect, height: 1 };
  return { width: 1, height: sourceAspect / targetAspect };
}

export function boxFitsStrictCrop(box: NormalizedBox, sourceAspect: number, targetAspect: number): boolean {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const expanded = expandBox(box, 0.08);
  return expanded.width <= nominal.width + EPSILON && expanded.height <= nominal.height + EPSILON;
}

export function cropAroundBox(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale = 0.3,
  padding = 0.18,
  centerYFraction = 0.44,
): NormalizedBox {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const expanded = expandBox(box, padding);
  const scale = clamp(Math.max(
    minimumScale,
    expanded.width / Math.max(EPSILON, nominal.width),
    expanded.height / Math.max(EPSILON, nominal.height),
  ), minimumScale, 1);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * centerYFraction;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function strictAspectViewport(
  viewport: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
): NormalizedBox {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const scale = clamp(Math.max(
    viewport.width / Math.max(EPSILON, nominal.width),
    viewport.height / Math.max(EPSILON, nominal.height),
  ), 0.05, 1);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function centerViewportOnBox(viewport: NormalizedBox, box: NormalizedBox): NormalizedBox {
  const centerX = box.x + box.width / 2;
  // A slight upward bias preserves natural headroom for both faces and bodies.
  const centerY = box.y + box.height * 0.44;
  return {
    ...viewport,
    x: clamp(centerX - viewport.width / 2, 0, 1 - viewport.width),
    y: clamp(centerY - viewport.height / 2, 0, 1 - viewport.height),
  };
}

export function containsBox(viewport: NormalizedBox, box: NormalizedBox): boolean {
  return box.x >= viewport.x - EPSILON
    && box.y >= viewport.y - EPSILON
    && box.x + box.width <= viewport.x + viewport.width + EPSILON
    && box.y + box.height <= viewport.y + viewport.height + EPSILON;
}

export function viewportScale(viewport: NormalizedBox, sourceAspect: number, targetAspect: number): number {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  return Math.max(
    viewport.width / Math.max(EPSILON, nominal.width),
    viewport.height / Math.max(EPSILON, nominal.height),
  );
}

export function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

export const layoutGeometry = {
  cropAroundBox,
  nominalCropSize,
  strictAspectViewport,
};
