import type { ImportanceRegion, NormalizedBox } from "../../../shared/smart-crop.util";
import type { VisibilityVariant } from "../../types/autoflip-layout.types";
import { framingCenterYFraction } from "./viewport-geometry.util";
import { fitViewport } from "./visibility-envelope.util";
import { variant } from "./visibility-rescue-helpers.util";

/** Tight crop on the primary box when a multi-subject union cannot share one frame. */
export function buildEmergencyPrimaryCrop(
  primary: ImportanceRegion,
  baseline: NormalizedBox,
  envelopes: ImportanceRegion[],
): VisibilityVariant {
  const center = {
    x: primary.box.x + primary.box.width / 2,
    y: primary.box.y + primary.box.height * framingCenterYFraction(primary.box, baseline.height),
  };
  const fitted = fitViewport(primary.box, baseline.width, baseline.height, center);
  const viewport = fitted ?? {
    x: Math.max(0, Math.min(1 - baseline.width, center.x - baseline.width / 2)),
    y: Math.max(0, Math.min(1 - baseline.height, center.y - baseline.height / 2)),
    width: baseline.width,
    height: baseline.height,
  };
  return variant("emergency-primary-crop", "single-crop", [viewport], envelopes);
}

export function primaryCoverageOf(
  candidate: VisibilityVariant,
  envelopes: ImportanceRegion[],
  primaryId: string,
): number {
  const index = envelopes.findIndex((region) => region.id === primaryId);
  return candidate.requiredCoverage[index >= 0 ? index : 0] ?? 0;
}
