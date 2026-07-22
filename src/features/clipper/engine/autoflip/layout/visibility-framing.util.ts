import { clamp } from "../../../lib/math.util";
import type { ImportanceRegionSample, NormalizedBox } from "../../../shared/smart-crop.util";
import { requiredRegions } from "./arbiter.util";
import type { SemanticFramingParams, VisibilityFramingState } from "../../types/autoflip-layout.types";
import {
  centerDistance,
  containsBox,
  expandBox,
  nominalCropSize,
  viewportScale,
} from "./viewport-geometry.util";

const EPSILON = 1e-9;

export function createVisibilityFramingState(): VisibilityFramingState {
  return { primaryId: null, observedKeyframes: 0, previousViewport: null };
}

function viewportAtScale(
  anchor: NormalizedBox,
  guard: NormalizedBox,
  scale: number,
  sourceAspect: number,
  targetAspect: number,
  centerYFraction: number,
): NormalizedBox | null {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  if (guard.width > width + EPSILON || guard.height > height + EPSILON) return null;
  const desiredX = anchor.x + anchor.width / 2 - width / 2;
  const desiredY = anchor.y + anchor.height * centerYFraction - height / 2;
  const minimumX = Math.max(0, guard.x + guard.width - width);
  const maximumX = Math.min(1 - width, guard.x);
  const minimumY = Math.max(0, guard.y + guard.height - height);
  const maximumY = Math.min(1 - height, guard.y);
  if (minimumX > maximumX + EPSILON || minimumY > maximumY + EPSILON) return null;
  return {
    x: clamp(desiredX, minimumX, maximumX),
    y: clamp(desiredY, minimumY, maximumY),
    width,
    height,
  };
}

function limitViewportMotion(
  candidate: NormalizedBox,
  previous: NormalizedBox,
  guard: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  params: SemanticFramingParams,
): NormalizedBox | null {
  const previousScale = viewportScale(previous, sourceAspect, targetAspect);
  const candidateScale = viewportScale(candidate, sourceAspect, targetAspect);
  const maxScaleStep = params.maxScaleStep ?? 0.05;
  const scale = clamp(candidateScale, previousScale - maxScaleStep, previousScale + maxScaleStep);
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const previousCenterX = previous.x + previous.width / 2;
  const previousCenterY = previous.y + previous.height / 2;
  const candidateCenterX = candidate.x + candidate.width / 2;
  const candidateCenterY = candidate.y + candidate.height / 2;
  const deltaX = candidateCenterX - previousCenterX;
  const deltaY = candidateCenterY - previousCenterY;
  const distance = Math.hypot(deltaX, deltaY);
  const maxCenterStep = params.maxCenterStep ?? 0.08;
  const factor = distance > maxCenterStep ? maxCenterStep / distance : 1;
  const limited = {
    x: clamp(previousCenterX + deltaX * factor - width / 2, 0, 1 - width),
    y: clamp(previousCenterY + deltaY * factor - height / 2, 0, 1 - height),
    width,
    height,
  };
  return containsBox(limited, guard) ? limited : null;
}

export function visibilityConstrainedViewport(
  importance: ImportanceRegionSample,
  legacyViewport: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  params: SemanticFramingParams,
  state: VisibilityFramingState,
  cut: boolean,
): NormalizedBox {
  const required = requiredRegions(importance);
  const primary = required.find((region) => region.role === "primary") ?? required[0];
  if (cut) {
    state.primaryId = null;
    state.observedKeyframes = 0;
    state.previousViewport = null;
  }
  if (!primary || required.length !== 1 || primary.predicted) {
    state.primaryId = null;
    state.observedKeyframes = 0;
    state.previousViewport = legacyViewport;
    return legacyViewport;
  }
  if (state.primaryId === primary.id) state.observedKeyframes++;
  else {
    state.primaryId = primary.id;
    state.observedKeyframes = 1;
  }
  const minimumObserved = params.stablePrimaryKeyframes ?? 5;
  if (cut || state.observedKeyframes < minimumObserved) {
    state.previousViewport = legacyViewport;
    return legacyViewport;
  }

  const guard = expandBox(primary.contentBox, params.visibilityGuardMargin ?? 0.08);
  const anchor = primary.box;
  const scales = [...new Set(params.allowedScales ?? [1, 0.95, 0.9, 0.8])]
    .filter((scale) => Number.isFinite(scale) && scale >= 0.8 && scale <= 1)
    .sort((a, b) => a - b);
  const candidates = scales
    .map((scale) => viewportAtScale(anchor, guard, scale, sourceAspect, targetAspect, params.centerYFraction))
    .filter((viewport): viewport is NormalizedBox => viewport != null && containsBox(viewport, guard));
  if (!candidates.length) {
    state.previousViewport = legacyViewport;
    return legacyViewport;
  }

  const anchorPoint = {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height * params.centerYFraction,
    width: 0,
    height: 0,
  };
  const previous = state.previousViewport;
  candidates.sort((a, b) => {
    const anchorDelta = centerDistance(a, anchorPoint) - centerDistance(b, anchorPoint);
    if (Math.abs(anchorDelta) > EPSILON) return anchorDelta;
    const compositionDelta = viewportScale(a, sourceAspect, targetAspect) - viewportScale(b, sourceAspect, targetAspect);
    if (Math.abs(compositionDelta) > EPSILON) return compositionDelta;
    if (!previous) return 0;
    const changeA = Math.abs(viewportScale(a, sourceAspect, targetAspect) - viewportScale(previous, sourceAspect, targetAspect))
      + centerDistance(a, previous);
    const changeB = Math.abs(viewportScale(b, sourceAspect, targetAspect) - viewportScale(previous, sourceAspect, targetAspect))
      + centerDistance(b, previous);
    return changeA - changeB;
  });
  let selected = candidates[0]!;
  if (previous) {
    const previousScale = viewportScale(previous, sourceAspect, targetAspect);
    const hysteresis = params.scaleHysteresis ?? 0.025;
    if (Math.abs(viewportScale(selected, sourceAspect, targetAspect) - previousScale) <= hysteresis) {
      selected = previous;
    }
    selected = limitViewportMotion(selected, previous, guard, sourceAspect, targetAspect, params) ?? legacyViewport;
  }
  if (!containsBox(selected, guard)) selected = legacyViewport;
  state.previousViewport = selected;
  return selected;
}
