import type { CollageRegion } from "../types/collage.types";
import type { ResolvedClipperLayout } from "../types/render.types";

/** Picks semantic layout vs face collage vs single-crop fallback for one frame. */
export function resolveFrameLayoutBranch(
  resolvedPlannedLayout: ResolvedClipperLayout | undefined,
  activeRegion: CollageRegion | null,
  disabledRegionIds: string[],
  collageEligible: boolean,
): { plannedLayout: ResolvedClipperLayout | undefined; useCollage: boolean } {
  const splitDisabledByUser = resolvedPlannedLayout?.mode === "split"
    && activeRegion != null
    && disabledRegionIds.includes(activeRegion.id);

  let plannedLayout = splitDisabledByUser ? undefined : resolvedPlannedLayout;

  if (
    plannedLayout != null
    && (plannedLayout.mode === "single-crop" || plannedLayout.mode === "contain")
    && collageEligible
  ) {
    plannedLayout = undefined;
  }

  return {
    plannedLayout,
    useCollage: plannedLayout == null && collageEligible,
  };
}
