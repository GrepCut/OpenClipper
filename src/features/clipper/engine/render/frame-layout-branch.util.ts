import type { CollageRegion } from "../types/collage.types";
import type { ResolvedClipperLayout } from "../types/render.types";

/** Applies user region overrides to the planned AutoFlip layout decision for one frame. */
export function resolveFrameLayoutBranch(
  resolvedPlannedLayout: ResolvedClipperLayout | undefined,
  activeRegion: CollageRegion | null,
  disabledRegionIds: string[],
): { plannedLayout: ResolvedClipperLayout | undefined } {
  if (!resolvedPlannedLayout) return { plannedLayout: undefined };

  const splitDisabledByUser = resolvedPlannedLayout.mode === "split"
    && activeRegion != null
    && disabledRegionIds.includes(activeRegion.id);

  if (splitDisabledByUser) {
    return {
      plannedLayout: {
        ...resolvedPlannedLayout,
        mode: "single-crop",
        viewports: [resolvedPlannedLayout.viewports[0]!],
      },
    };
  }

  return { plannedLayout: resolvedPlannedLayout };
}
