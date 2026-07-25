import { evenInt } from "../../lib/media/video-draw.util";
import {
  FrameCanvasCache,
  resetContext,
  type FrameEffectSize,
} from "../../lib/media/video-frame-effect.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import { canonicalFormatDims } from "../../shared/formats.util";
import type { ClipperResolutionCap, ClipperSettings } from "../../settings/settings.util";
import type { ClipperFrameContext } from "../types/render.types";
import { resolveFrameLayoutBranch } from "./frame-layout-branch.util";
import { deriveRegionsFromLayoutTracks, findActiveRegion } from "../reframe/collage";
import { resolveAutoFlipCropRender } from "./crop-resolvers.util";
import { resolveClipperLayoutRender } from "./layout-resolvers.util";
import {
  drawClipperCaptions,
  drawClipperLayoutFrame,
  drawClipperPlatformFrame,
  drawDebugFocusMarker,
} from "./canvas-draw.util";

function applyResolutionCap(
  dims: FrameEffectSize,
  cap: ClipperResolutionCap,
): FrameEffectSize {
  if (cap === "source") return dims;
  const targetShort = cap === "1080p" ? 1080 : 720;
  const currentShort = Math.min(dims.width, dims.height);
  if (currentShort <= targetShort) return dims;
  const scale = targetShort / currentShort;
  return { width: evenInt(dims.width * scale), height: evenInt(dims.height * scale) };
}

export function resolveClipperOutputSize(
  formatDef: ClipperFormatDef,
  resolutionCap: ClipperResolutionCap,
): FrameEffectSize {
  return applyResolutionCap(canonicalFormatDims(formatDef), resolutionCap);
}

export function formatNeedsFaceTracking(formatDef: ClipperFormatDef, settings: ClipperSettings): boolean {
  void settings;
  return formatDef.mode === "crop";
}

/** Full per-frame draw: crop/collage framing + captions. Shared by the live preview and the final render. */
export function drawClipperFrame(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  t: number,
  render: ClipperFrameContext,
  isPreview = false,
): void {
  const needsTracking = formatNeedsFaceTracking(formatDef, render.settings);
  const resolvedPlannedLayout = formatDef.mode === "crop"
    ? resolveClipperLayoutRender(render.smartCropAnalysis, formatDef.id, source, t)
    : undefined;
  const collageRegions = needsTracking
    ? deriveRegionsFromLayoutTracks(render.smartCropAnalysis)
    : [];

  const activeRegion = needsTracking ? findActiveRegion(collageRegions, t) : null;
  const { plannedLayout } = resolveFrameLayoutBranch(
    resolvedPlannedLayout,
    activeRegion,
    render.disabledCollageRegionIds,
  );

  const showDebug = isPreview && render.settings.reframe.showDebugFaceBoxes && formatDef.mode === "crop";
  const contentRect = render.smartCropAnalysis?.contentRect;

  if (plannedLayout) {
    drawClipperLayoutFrame(formatDef, ctx, frame, source, output, plannedLayout, contentRect);
  } else {
    const autoFlipRender = resolveAutoFlipCropRender(render.smartCropAnalysis, formatDef.id, source, t);
    const cropRect = autoFlipRender?.cropRect;
    drawClipperPlatformFrame(
      formatDef,
      ctx,
      frame,
      source,
      output,
      cropRect,
      autoFlipRender?.solidBackgroundColor,
      contentRect,
    );

    if (showDebug && cropRect) {
      const centroid = {
        x: (cropRect.sx + cropRect.sw / 2) / source.width,
        y: (cropRect.sy + cropRect.sh / 2) / source.height,
      };
      drawDebugFocusMarker(ctx, output, cropRect, source, centroid);
    }
  }

  drawClipperCaptions(formatDef, ctx, output, t, render);
}

/** Draws one preview frame onto a display canvas at a fixed height. */
export function drawClipperPreviewFrame(
  canvas: HTMLCanvasElement,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  formatDef: ClipperFormatDef,
  render: ClipperFrameContext,
  timestampSec: number,
  displayHeight: number,
  cache: FrameCanvasCache,
): void {
  const canonicalOutput = resolveClipperOutputSize(formatDef, render.settings.formats.resolutionCap);
  const scale = displayHeight / canonicalOutput.height;
  const displayW = Math.round(canonicalOutput.width * scale);
  const displayH = displayHeight;
  // Preview is a display-only render. Compositing at the final 1080p output
  // and then shrinking it forced six expensive CPU canvas passes per video
  // frame. Geometry is normalized, so rendering directly at display size is
  // visually equivalent while keeping captions and layout decisions intact.
  const output = { width: displayW, height: displayH };

  if (canvas.width !== displayW) canvas.width = displayW;
  if (canvas.height !== displayH) canvas.height = displayH;

  const ctx = cache.get(displayW, displayH);
  ctx.save();
  resetContext(ctx, displayW, displayH);
  try {
    drawClipperFrame(formatDef, ctx, frame, source, output, timestampSec, render, true);
  } finally {
    ctx.restore();
  }

  const displayCtx = canvas.getContext("2d", { desynchronized: true });
  if (!displayCtx) return;
  displayCtx.drawImage(ctx.canvas, 0, 0, displayW, displayH);
}
