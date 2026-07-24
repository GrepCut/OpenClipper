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
    // Above this threshold the two panels would mostly repeat the same
    // content. Keep the primary subject in a single frame instead.
    if (overlap <= 0.2) return "split";
  }
  return "single-crop";
}
