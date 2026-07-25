import { clamp } from "../../../lib/math.util";
import type { NormalizedBox } from "../../../shared/smart-crop.util";
import { importanceGeometry } from "../salience/importance-ranker.util";

const EPSILON = 1e-9;

/**
 * A split panel must show distinct subjects without overlapping viewports or
 * visual crowding. Source crops must be disjoint (0% overlap) and separated by
 * at least 10% of normalized frame width.
 */
export const MAX_SPLIT_VIEWPORT_OVERLAP = 0.0;
export const MIN_SPLIT_VIEWPORT_GAP = 0.10;

export function boxesIntersect(a: NormalizedBox, b: NormalizedBox): boolean {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapX > EPSILON && overlapY > EPSILON;
}

export function splitViewportsAreDistinct(
  viewports: NormalizedBox[],
  minGap = MIN_SPLIT_VIEWPORT_GAP,
): boolean {
  if (viewports.length < 2) return true;
  return viewports.every((viewport, index) =>
    viewports.slice(index + 1).every((other) => {
      if (boxesIntersect(viewport, other)) return false;
      if (importanceGeometry.overlapFractionOfSmaller(viewport, other) > MAX_SPLIT_VIEWPORT_OVERLAP + EPSILON) {
        return false;
      }
      const gapX = Math.max(viewport.x, other.x) - Math.min(viewport.x + viewport.width, other.x + other.width);
      const gapY = Math.max(viewport.y, other.y) - Math.min(viewport.y + viewport.height, other.y + other.height);
      const minDistance = Math.max(gapX, gapY);
      return minDistance >= minGap - EPSILON;
    }));
}

/** A split panel owns one face core. It must contain its owner and may not
 * intersect another panel's owner. This is an invariant, not a score threshold. */
export function splitPanelsPreserveSubjects(
  viewports: NormalizedBox[],
  panelSubjects: Array<{ id: string; focusBox: NormalizedBox }> | undefined,
): boolean {
  if (!panelSubjects) return true; // legacy analyses are re-run by the version gate.
  if (viewports.length < 2 || viewports.length !== panelSubjects.length) return false;
  return panelSubjects.every((subject, index) =>
    containsBox(viewports[index]!, subject.focusBox)
    && viewports.every((viewport, otherIndex) =>
      otherIndex === index || !boxesIntersect(viewport, subject.focusBox)));
}

export interface SplitPanelRegionInput {
  box: NormalizedBox;
  contentBox: NormalizedBox;
  id: string;
}

export function fitSeparatedSplitPanels(
  panelRegions: SplitPanelRegionInput[],
  sourceAspect: number,
  targetAspects: number[],
  minGap = MIN_SPLIT_VIEWPORT_GAP,
  minScaleThreshold = 0.35,
): NormalizedBox[] | null {
  if (panelRegions.length !== targetAspects.length) return null;
  const panelSubjects = panelRegions.map((region) => ({ id: region.id, focusBox: region.box }));
  const scaleMultipliers = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35];

  for (const k of scaleMultipliers) {
    const panels = panelRegions.map((region, index) => {
      const targetAspect = targetAspects[index]!;
      const nominal = nominalCropSize(sourceAspect, targetAspect);
      const rawScale = Math.max(
        minScaleThreshold,
        region.contentBox.width / Math.max(EPSILON, nominal.width),
        region.contentBox.height / Math.max(EPSILON, nominal.height),
      );
      const clampedScale = Math.min(1, Math.max(minScaleThreshold, rawScale * k));
      const width = nominal.width * clampedScale;
      const height = nominal.height * clampedScale;
      const faceCenter = {
        x: region.box.x + region.box.width / 2,
        y: region.box.y + region.box.height * framingCenterYFraction(region.box, height),
      };

      if (region.contentBox.width > width + EPSILON || region.contentBox.height > height + EPSILON) {
        return null;
      }
      const minimumX = Math.max(0, region.contentBox.x + region.contentBox.width - width);
      const maximumX = Math.min(1 - width, region.contentBox.x);
      const minimumY = Math.max(0, region.contentBox.y + region.contentBox.height - height);
      const maximumY = Math.min(1 - height, region.contentBox.y);
      if (minimumX > maximumX + EPSILON || minimumY > maximumY + EPSILON) return null;

      return {
        x: clamp(faceCenter.x - width / 2, minimumX, maximumX),
        y: clamp(faceCenter.y - height / 2, minimumY, maximumY),
        width,
        height,
      };
    });

    if (
      panels.every((panel): panel is NormalizedBox => panel != null)
      && splitViewportsAreDistinct(panels, minGap)
      && splitPanelsPreserveSubjects(panels, panelSubjects)
    ) {
      return panels;
    }
  }

  return null;
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

export const HEADROOM_CENTER_Y = 0.44;
export const CENTER_Y = 0.5;

/**
 * Headroom only when it cannot expose empty/letterbox at the top of the
 * output. Full-height crops and top-pinned placements must stay centered.
 */
export function framingCenterYFraction(
  subjectBox: NormalizedBox,
  cropHeight: number,
  headroomFraction = HEADROOM_CENTER_Y,
): number {
  // Full-height portrait crop: no vertical room — bias only creates empty top.
  if (cropHeight >= 1 - EPSILON) return CENTER_Y;
  // Subject already at the top of the source: nothing real above to lean into.
  if (subjectBox.y < 0.04) return CENTER_Y;
  // Headroom would pin the crop to the top edge → black/empty bar risk.
  const desiredTop = subjectBox.y + subjectBox.height * headroomFraction - cropHeight / 2;
  if (desiredTop <= 0.02) return CENTER_Y;
  return headroomFraction;
}

export function cropAroundBox(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale = 0.3,
  padding = 0.18,
  centerYFraction = HEADROOM_CENTER_Y,
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
  const centerY = box.y + box.height * framingCenterYFraction(box, height, centerYFraction);
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
  const centerY = box.y + box.height * framingCenterYFraction(box, viewport.height);
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
