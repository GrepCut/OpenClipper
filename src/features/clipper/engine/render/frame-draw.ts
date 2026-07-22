import { evenInt } from "../../lib/media/video-draw";
import {
  FrameCanvasCache,
  resetContext,
  type FrameEffectSize,
} from "../../lib/media/video-frame-effect";
import type { ClipperFormatDef } from "../../shared/formats";
import { canonicalFormatDims } from "../../shared/formats";
import type { ClipperResolutionCap, ClipperSettings } from "../../settings/settings";
import type { ClipperClipSegmentWindow } from "../segmentation/types";
import type { ClipperSmartCropBlob } from "../../shared/smart-crop";
import type { CaptionGroup } from "../../lib/media/transcription-export";
import {
  buildCollageTracksForRegions,
  type CollageAspectEligibility,
  type CollageRegion,
  deriveCollageAspectEligibility,
  deriveTwoSpeakerRegions,
  drawPodcastCollageFrame,
  findActiveRegion,
  isCollageAspectEligible,
  type CollageTracks,
} from "../reframe/collage";
import {
  type CentroidSample,
  deriveSingleFocusTrack,
  FaceSampleCache,
} from "../reframe";
import { resolveCropRect, resolveAutoFlipCropRender } from "./crop-resolvers";
import { resolveClipperLayoutRender } from "./layout-resolvers";
import {
  drawClipperCaptions,
  drawClipperLayoutFrame,
  drawClipperPlatformFrame,
  drawDebugFocusMarker,
} from "./canvas-draw";

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

/** Everything needed to render one frame's crop + captions for a given settings snapshot. */
export interface ClipperFrameContext {
  settings: ClipperSettings;
  captionGroups: CaptionGroup[];
  faceCache: FaceSampleCache | null;
  faceRender?: {
    focusTrack: CentroidSample[];
    collageTracks: CollageTracks;
    collageRegions: CollageRegion[];
    collageEligibility: CollageAspectEligibility;
  };
  smartCropAnalysis?: ClipperSmartCropBlob | null;
  disabledCollageRegionIds: string[];
  segments?: ClipperClipSegmentWindow[];
}

export function formatNeedsFaceTracking(formatDef: ClipperFormatDef, settings: ClipperSettings): boolean {
  if (formatDef.mode !== "crop") return false;
  const mode = settings.reframe.cropMode;
  return mode === "center" || mode === "smart-follow" || mode === "face-follow" || mode === "podcast-collage";
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
  const resolvedPlannedLayout = render.settings.reframe.cropMode === "smart-follow" && formatDef.mode === "crop"
    ? resolveClipperLayoutRender(render.smartCropAnalysis, formatDef.id, source, t)
    : undefined;
  const samples = needsTracking && !render.faceRender ? render.faceCache?.sortedSamples() ?? [] : [];
  const collageRegions = needsTracking
    ? (render.faceRender?.collageRegions ?? deriveTwoSpeakerRegions(samples))
    : [];
  const collageTracks = needsTracking
    ? (render.faceRender?.collageTracks
      ?? buildCollageTracksForRegions(
        samples,
        render.settings.reframe.smoothing,
        collageRegions,
        render.disabledCollageRegionIds,
      ))
    : null;
  const collageEligibility = needsTracking
    ? (render.faceRender?.collageEligibility
      ?? deriveCollageAspectEligibility(samples, collageRegions, render.settings.reframe.headroom))
    : null;

  const activeRegion = needsTracking ? findActiveRegion(collageRegions, t) : null;
  const plannedLayout = resolvedPlannedLayout?.mode === "split"
    && activeRegion != null
    && render.disabledCollageRegionIds.includes(activeRegion.id)
    ? undefined
    : resolvedPlannedLayout;
  const useCollage =
    plannedLayout == null &&
    render.settings.reframe.cropMode !== "manual" &&
    formatDef.mode === "crop" &&
    activeRegion != null &&
    !render.disabledCollageRegionIds.includes(activeRegion.id) &&
    isCollageAspectEligible(collageEligibility!, formatDef.aspectId, activeRegion.id, t);

  const showDebug = isPreview && render.settings.reframe.showDebugFaceBoxes && formatDef.mode === "crop";

  if (plannedLayout) {
    drawClipperLayoutFrame(formatDef, ctx, frame, source, output, plannedLayout);
  } else if (useCollage) {
    drawPodcastCollageFrame(
      ctx,
      frame,
      source,
      output,
      collageTracks!,
      t,
      render.settings.reframe.headroom,
      true,
    );
  } else {
    const isSmartFollow = render.settings.reframe.cropMode === "smart-follow";
    const focusTrack = needsTracking && !isSmartFollow
      ? (render.faceRender?.focusTrack
        ?? deriveSingleFocusTrack(samples, render.settings.reframe.facePickStrategy, render.settings.reframe.smoothing))
      : null;
    const autoFlipRender = isSmartFollow
      ? resolveAutoFlipCropRender(render.smartCropAnalysis, formatDef.id, source, t)
      : undefined;
    const cropRect = isSmartFollow
      ? autoFlipRender?.cropRect
      : resolveCropRect(formatDef, source, output, t, render.settings, focusTrack);
    drawClipperPlatformFrame(
      formatDef,
      ctx,
      frame,
      source,
      output,
      cropRect,
      isSmartFollow ? autoFlipRender?.solidBackgroundColor : undefined,
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
  const output = resolveClipperOutputSize(formatDef, render.settings.formats.resolutionCap);
  const scale = displayHeight / output.height;
  const displayW = Math.round(output.width * scale);
  const displayH = displayHeight;

  if (canvas.width !== displayW) canvas.width = displayW;
  if (canvas.height !== displayH) canvas.height = displayH;

  const ctx = cache.get(output.width, output.height);
  ctx.save();
  resetContext(ctx, output.width, output.height);
  try {
    drawClipperFrame(formatDef, ctx, frame, source, output, timestampSec, render, true);
  } finally {
    ctx.restore();
  }

  const displayCtx = canvas.getContext("2d", { desynchronized: true });
  if (!displayCtx) return;
  displayCtx.drawImage(ctx.canvas, 0, 0, displayW, displayH);
}
