import type { ClipperLayoutMode, NormalizedBox } from "../../../shared/smart-crop.util";
import { viewportArea } from "../camera/shot-smoothing.util";
import { requiredRegions } from "./arbiter.util";
import { framingCenterYFraction } from "./viewport-geometry.util";

const EPSILON = 1e-9;

interface GroupUnionLayout {
  mode: ClipperLayoutMode;
  viewports: NormalizedBox[];
  reasonCode: "group-union-crop" | "group-stable-split";
}

function minSubjectDisplayHeight(
  viewport: NormalizedBox,
  required: ReturnType<typeof requiredRegions>,
): number {
  if (!required.length) return 0;
  return Math.min(
    ...required.map((region) => {
      const top = Math.max(viewport.y, region.contentBox.y);
      const bottom = Math.min(viewport.y + viewport.height, region.contentBox.y + region.contentBox.height);
      const visible = Math.max(0, bottom - top);
      return visible / Math.max(EPSILON, region.contentBox.height);
    }),
  );
}

/** group-union must beat contain on area AND subject display height (handoff §3.4). */
export function groupUnionLexicographicOk(
  groupViewport: NormalizedBox,
  fallbackViewport: NormalizedBox,
  required: ReturnType<typeof requiredRegions>,
): boolean {
  const groupArea = viewportArea(groupViewport);
  const fallbackArea = viewportArea(fallbackViewport);
  if (groupArea > fallbackArea + EPSILON) return false;
  const groupHeight = minSubjectDisplayHeight(groupViewport, required);
  const fallbackHeight = minSubjectDisplayHeight(fallbackViewport, required);
  return groupHeight + EPSILON >= fallbackHeight;
}

function unionBoxesForGroup(boxes: NormalizedBox[]): NormalizedBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function fitAspectViewport(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale: number,
  margin: number,
): NormalizedBox | null {
  const left = Math.max(0, box.x - box.width * margin);
  const top = Math.max(0, box.y - box.height * margin);
  const right = Math.min(1, box.x + box.width * (1 + margin));
  const bottom = Math.min(1, box.y + box.height * (1 + margin));
  const expanded = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  const normalizedAspect = targetAspect / Math.max(1e-9, sourceAspect);
  const nominal =
    normalizedAspect <= 1
      ? { width: normalizedAspect, height: 1 }
      : { width: 1, height: 1 / normalizedAspect };
  const scale = Math.max(
    minimumScale,
    expanded.width / Math.max(1e-9, nominal.width),
    expanded.height / Math.max(1e-9, nominal.height),
  );
  if (scale > 1 + 1e-9) return null;
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const minimumX = Math.max(0, expanded.x + expanded.width - width);
  const maximumX = Math.min(1 - width, expanded.x);
  const minimumY = Math.max(0, expanded.y + expanded.height - height);
  const maximumY = Math.min(1 - height, expanded.y);
  if (minimumX > maximumX + 1e-9 || minimumY > maximumY + 1e-9) return null;
  const centerX = expanded.x + expanded.width / 2;
  const centerY = expanded.y + expanded.height * framingCenterYFraction(expanded, height);
  return {
    x: Math.max(minimumX, Math.min(maximumX, centerX - width / 2)),
    y: Math.max(minimumY, Math.min(maximumY, centerY - height / 2)),
    width,
    height,
  };
}

/** Minimal group crop; impossible 3+ geometry falls back instead of contain. */
export function buildGroupUnionLayout(
  boxes: NormalizedBox[],
  sourceAspect: number,
  targetAspect: number,
  options: { minimumScale?: number; margin?: number } = {},
): GroupUnionLayout | null {
  if (boxes.length < 2) return null;
  const minimumScale = options.minimumScale ?? 0.55;
  const margin = options.margin ?? 0.08;
  const common = fitAspectViewport(
    unionBoxesForGroup(boxes),
    sourceAspect,
    targetAspect,
    minimumScale,
    margin,
  );
  if (common) {
    return {
      mode: "single-crop",
      viewports: [common],
      reasonCode: "group-union-crop",
    };
  }
  if (boxes.length !== 2) return null;
  const panels = [...boxes]
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2))
    .map((box) =>
      fitAspectViewport(
        box,
        sourceAspect,
        targetAspect * 2,
        minimumScale,
        margin,
      ),
    );
  if (!panels.every((panel): panel is NormalizedBox => panel != null))
    return null;
  return { mode: "split", viewports: panels, reasonCode: "group-stable-split" };
}
