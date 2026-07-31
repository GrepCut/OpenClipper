import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CLIPPER_PUBLISH_PANEL_MIN_WIDTH = 300;
export const CLIPPER_PUBLISH_PANEL_MAX_WIDTH = 720;
export const CLIPPER_PUBLISH_PANEL_DEFAULT_WIDTH = 420;

interface ClipperPublishSplitState {
  panelWidthPx: number;
  setPanelWidthPx: (width: number) => void;
}

export function clampClipperPublishPanelWidth(
  width: number,
  containerWidth?: number,
): number {
  const maxByContainer =
    containerWidth != null
      ? Math.min(CLIPPER_PUBLISH_PANEL_MAX_WIDTH, Math.floor(containerWidth * 0.65))
      : CLIPPER_PUBLISH_PANEL_MAX_WIDTH;
  const maxWidth = Math.max(CLIPPER_PUBLISH_PANEL_MIN_WIDTH, maxByContainer);
  return Math.min(maxWidth, Math.max(CLIPPER_PUBLISH_PANEL_MIN_WIDTH, Math.round(width)));
}

export const useClipperPublishSplitStore = create<ClipperPublishSplitState>()(
  persist(
    (set) => ({
      panelWidthPx: CLIPPER_PUBLISH_PANEL_DEFAULT_WIDTH,
      setPanelWidthPx: (width) =>
        set({ panelWidthPx: clampClipperPublishPanelWidth(width) }),
    }),
    {
      name: "clipper-publish-split",
      version: 1,
    },
  ),
);
