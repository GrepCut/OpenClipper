import type { ClipperLayoutMode, ImportanceRegionSample } from "../../../shared/smart-crop.util";
import { importanceGeometry } from "../salience/importance-ranker.util";
import { requiredRegions } from "./arbiter.util";
import { boxFitsStrictCrop, unionAll } from "./viewport-geometry.util";

export function rawMode(
  sample: ImportanceRegionSample,
  sourceAspect: number,
  targetAspect: number,
): ClipperLayoutMode {
  const required = requiredRegions(sample);
  if (!required.length) return "single-crop";
  const union = unionAll(required.map((region) => region.contentBox))!;
  if (boxFitsStrictCrop(union, sourceAspect, targetAspect)) return "single-crop";
  if (required.length >= 2) {
    const overlap = importanceGeometry.overlapFractionOfSmaller(required[0]!.contentBox, required[1]!.contentBox);
    if (overlap < 0.35) return "split";
  }
  return "single-crop";
}
