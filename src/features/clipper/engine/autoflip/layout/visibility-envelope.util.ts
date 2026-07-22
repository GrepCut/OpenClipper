import type { ImportanceRegion, ImportanceRegionSample, NormalizedBox } from "../../../shared/smart-crop.util";
import { clamp } from "../../../lib/math.util";
import { importanceGeometry } from "../salience/importance-ranker.util";
import { coveredFraction, requiredRegions } from "./arbiter.util";
import { nominalCropSize } from "./viewport-geometry.util";
import type { VisibilityControllerParams } from "../../types/autoflip-layout.types";

const EPSILON = 1e-9;

export function expand(box: NormalizedBox, marginX: number, marginY = marginX): NormalizedBox {
  const x = clamp(box.x - marginX, 0, 1);
  const y = clamp(box.y - marginY, 0, 1);
  const right = clamp(box.x + box.width + marginX, 0, 1);
  const bottom = clamp(box.y + box.height + marginY, 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

export function union(boxes: NormalizedBox[]): NormalizedBox | null {
  return boxes.reduce<NormalizedBox | null>(
    (result, box) => result ? importanceGeometry.unionBoxes(result, box) : { ...box },
    null,
  );
}

export function coverage(viewports: NormalizedBox[], regions: ImportanceRegion[]): number[] {
  return regions.map((region) => Math.max(0, ...viewports.map((viewport) => coveredFraction(viewport, region.contentBox))));
}

export function coversAll(values: number[], threshold = 1 - EPSILON): boolean {
  return values.length > 0 && values.every((value) => value >= threshold);
}

export function fitViewport(
  anchor: NormalizedBox,
  width: number,
  height: number,
  preferredCenter?: { x: number; y: number },
): NormalizedBox | null {
  if (anchor.width > width + EPSILON || anchor.height > height + EPSILON) return null;
  const minimumX = Math.max(0, anchor.x + anchor.width - width);
  const maximumX = Math.min(1 - width, anchor.x);
  const minimumY = Math.max(0, anchor.y + anchor.height - height);
  const maximumY = Math.min(1 - height, anchor.y);
  if (minimumX > maximumX + EPSILON || minimumY > maximumY + EPSILON) return null;
  const center = preferredCenter ?? {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height * 0.44,
  };
  return {
    x: clamp(center.x - width / 2, minimumX, maximumX),
    y: clamp(center.y - height / 2, minimumY, maximumY),
    width,
    height,
  };
}

export function cropForEnvelope(
  envelope: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale: number,
): NormalizedBox | null {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const scale = clamp(Math.max(
    minimumScale,
    envelope.width / Math.max(EPSILON, nominal.width),
    envelope.height / Math.max(EPSILON, nominal.height),
  ), minimumScale, 1);
  return fitViewport(envelope, nominal.width * scale, nominal.height * scale);
}

function findPreviousRegion(
  samples: ImportanceRegionSample[],
  index: number,
  id: string,
): { region: ImportanceRegion; time: number } | null {
  const currentTime = samples[index]?.time ?? 0;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const sample = samples[cursor]!;
    if (samples[cursor + 1]?.cut || sample.cut || currentTime - sample.time > 0.6) break;
    const region = sample.regions.find((candidate) => candidate.id === id && !candidate.predicted);
    if (region) return { region, time: sample.time };
  }
  return null;
}

/** Builds a motion-aware envelope from observed evidence and same-scene offline lookahead. */
export function buildVisibilityEnvelopes(
  samples: ImportanceRegionSample[],
  index: number,
  params: VisibilityControllerParams,
): ImportanceRegion[] {
  const sample = samples[index] ?? { time: 0, regions: [] };
  return requiredRegions(sample).map((region) => {
    let contentBox = { ...region.contentBox };
    const previous = findPreviousRegion(samples, index, region.id);
    const currentCenterX = region.contentBox.x + region.contentBox.width / 2;
    const currentCenterY = region.contentBox.y + region.contentBox.height / 2;
    let speedX = 0;
    let speedY = 0;
    if (previous && sample.time > previous.time + EPSILON) {
      const dt = sample.time - previous.time;
      speedX = (currentCenterX - (previous.region.contentBox.x + previous.region.contentBox.width / 2)) / dt;
      speedY = (currentCenterY - (previous.region.contentBox.y + previous.region.contentBox.height / 2)) / dt;
    }
    for (let cursor = index + 1; cursor < samples.length; cursor++) {
      const future = samples[cursor]!;
      if (future.cut || future.time - sample.time > params.lookaheadSec + EPSILON) break;
      const next = future.regions.find((candidate) => candidate.id === region.id);
      if (next) contentBox = importanceGeometry.unionBoxes(contentBox, next.contentBox);
    }
    const speedMarginX = Math.min(0.12, Math.abs(speedX) * params.velocityMarginSec);
    const speedMarginY = Math.min(0.08, Math.abs(speedY) * params.velocityMarginSec);
    contentBox = expand(
      contentBox,
      params.envelopeMargin * Math.max(0.02, region.contentBox.width) + speedMarginX,
      params.envelopeMargin * Math.max(0.02, region.contentBox.height) + speedMarginY,
    );
    return { ...region, contentBox };
  });
}
