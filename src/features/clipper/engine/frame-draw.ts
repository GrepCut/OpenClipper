import {
  type CaptionRenderExtra,
  drawPhraseAnimatedCaption,
} from '../lib/captions/animated-caption-render';
import type { SubtitleStyle } from '../lib/captions/subtitle-render';
import type { CaptionGroup } from "../lib/media/transcription-export";
import { drawFrameContain, evenInt } from "../lib/media/video-draw";
import {
  FrameCanvasCache,
  resetContext,
  type FrameEffectSize,
} from "../lib/media/video-frame-effect";
import type { ClipperFormatDef } from "../shared/formats";
import type { AutoFlipAspectTrack, ClipperLayoutMode, ClipperSmartCropBlob, NormalizedBox } from "../shared/smart-crop";
import { canonicalFormatDims } from "../shared/formats";
import type { ClipperResolutionCap, ClipperSettings } from "../settings/settings";
import type { ClipperClipSegmentWindow } from "./clip-segmentation";
import { sourceTimeToLocalTime } from "./clip-segment-time";
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
} from "./collage";
import {
  type CentroidSample,
  type ClipperCropRect,
  cropRectForCentroid,
  deriveSingleFocusTrack,
  FaceSampleCache,
  interpolateCentroid,
} from "./reframe";
import { resolveAutoFlipCropTrack } from "./autoflip/build-autoflip-track";
import { interpolateLayoutSample, resolveLayoutTrack } from "./autoflip/layout-planner";

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

export function resolveCropRect(
  formatDef: ClipperFormatDef,
  source: FrameEffectSize,
  output: FrameEffectSize,
  t: number,
  settings: ClipperSettings,
  focusTrack: CentroidSample[] | null,
): ClipperCropRect | undefined {
  if (formatDef.mode !== "crop") return undefined;
  const targetRatio = output.width / output.height;
  const { cropMode, headroom, manualFocalPoint } = settings.reframe;

  if (cropMode === "manual") {
    return cropRectForCentroid(source.width, source.height, manualFocalPoint.x, manualFocalPoint.y, targetRatio, headroom);
  }
  if (
    (cropMode === "center" || cropMode === "smart-follow" || cropMode === "face-follow" || cropMode === "podcast-collage") &&
    focusTrack &&
    focusTrack.length > 0
  ) {
    const c = interpolateCentroid(focusTrack, t);
    return cropRectForCentroid(source.width, source.height, c.x, c.y, targetRatio, headroom, c.extent);
  }
  return undefined;
}

function interpolateAutoFlipCrop(track: AutoFlipAspectTrack, time: number): { crop: NormalizedBox; solidBackgroundColor?: { r: number; g: number; b: number } } | null {
  const samples = track.samples;
  if (!samples.length) return null;
  if (time <= samples[0]!.t) return { crop: samples[0]!.crop, solidBackgroundColor: samples[0]!.solidBackgroundColor };
  const last = samples.at(-1)!;
  if (time >= last.t) return { crop: last.crop, solidBackgroundColor: last.solidBackgroundColor };
  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (samples[middle]!.t < time) low = middle + 1;
    else high = middle;
  }
  const next = samples[low]!;
  const previous = samples[low - 1]!;
  // A shot boundary is a discontinuity: holding the prior crop avoids an
  // invented pan between unrelated shots.
  if (next.cut) return { crop: previous.crop, solidBackgroundColor: previous.solidBackgroundColor };
  const factor = (time - previous.t) / Math.max(Number.EPSILON, next.t - previous.t);
  return {
    crop: {
      x: previous.crop.x + (next.crop.x - previous.crop.x) * factor,
      y: previous.crop.y + (next.crop.y - previous.crop.y) * factor,
      width: previous.crop.width + (next.crop.width - previous.crop.width) * factor,
      height: previous.crop.height + (next.crop.height - previous.crop.height) * factor,
    },
    // Padding changes only at a shot boundary; preserve the preceding scene's
    // decision while interpolating within it.
    solidBackgroundColor: previous.solidBackgroundColor,
  };
}

/** Converts the normalized crop emitted by AutoFlip into source pixels. */
export function resolveAutoFlipCropRect(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): ClipperCropRect | undefined {
  return resolveAutoFlipCropRender(blob, formatId, source, time)?.cropRect;
}

export function resolveAutoFlipCropRender(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): { cropRect: ClipperCropRect; solidBackgroundColor?: { r: number; g: number; b: number } } | undefined {
  if (!blob) return undefined;
  const resolved = interpolateAutoFlipCrop(resolveAutoFlipCropTrack(blob, formatId) ?? { targetAspectRatio: 1, samples: [] }, time);
  if (!resolved) return undefined;
  return {
    cropRect: { sx: resolved.crop.x * source.width, sy: resolved.crop.y * source.height, sw: resolved.crop.width * source.width, sh: resolved.crop.height * source.height },
    solidBackgroundColor: resolved.solidBackgroundColor ?? blob.solidBackgroundColor,
  };
}

export interface ResolvedClipperLayout {
  mode: ClipperLayoutMode;
  viewports: ClipperCropRect[];
  solidBackgroundColor?: { r: number; g: number; b: number };
}

/** Resolves a v3 editing decision; absent on persisted legacy analyses. */
export function resolveClipperLayoutRender(
  blob: ClipperSmartCropBlob | null | undefined,
  formatId: string,
  source: FrameEffectSize,
  time: number,
): ResolvedClipperLayout | undefined {
  if (!blob) return undefined;
  const sample = interpolateLayoutSample(resolveLayoutTrack(blob.layoutTracks, formatId), time);
  if (!sample?.viewports.length || sample.strategy === "legacy-baseline") return undefined;
  return {
    mode: sample.mode,
    viewports: sample.viewports.map((viewport) => ({
      sx: viewport.x * source.width,
      sy: viewport.y * source.height,
      sw: viewport.width * source.width,
      sh: viewport.height * source.height,
    })),
    solidBackgroundColor: sample.solidBackgroundColor ?? blob.solidBackgroundColor,
  };
}

/** Draws an explicit v3 crop/split/contain decision. */
export function drawClipperLayoutFrame(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  layout: ResolvedClipperLayout,
): void {
  if (layout.mode !== "split" || layout.viewports.length < 2) {
    drawClipperPlatformFrame(
      formatDef,
      ctx,
      frame,
      source,
      output,
      layout.viewports[0],
      layout.solidBackgroundColor,
    );
    return;
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);
  const topHeight = evenInt(output.height / 2);
  const bottomHeight = output.height - topHeight;
  const [top, bottom] = layout.viewports;
  ctx.drawImage(frame, top!.sx, top!.sy, top!.sw, top!.sh, 0, 0, output.width, topHeight);
  ctx.drawImage(frame, bottom!.sx, bottom!.sy, bottom!.sw, bottom!.sh, 0, topHeight, output.width, bottomHeight);
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, topHeight - 1.5, output.width, 3);
}

/** Draws one crop/pad-framed frame — no captions/branding. */
export function drawClipperPlatformFrame(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  cropRect?: ClipperCropRect,
  solidBackgroundColor?: { r: number; g: number; b: number },
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);

  if (formatDef.mode === "pad") {
    // AutoFlip's padding effect is a heavily blurred source background with a
    // 0.6 dark overlay, then the uncropped foreground on top.
    const coverScale = Math.max(output.width / source.width, output.height / source.height);
    const backgroundW = source.width * coverScale;
    const backgroundH = source.height * coverScale;
    ctx.save();
    ctx.filter = "blur(100px)";
    ctx.drawImage(frame, (output.width - backgroundW) / 2, (output.height - backgroundH) / 2, backgroundW, backgroundH);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.restore();
    drawFrameContain(ctx, frame, 0, 0, output.width, output.height, source.width, source.height);
    return;
  }

  if (cropRect) {
    const cropRatio = cropRect.sw / Math.max(1, cropRect.sh);
    const outputRatio = output.width / output.height;
    if (Math.abs(cropRatio - outputRatio) > 0.001) {
      // Required salient regions can enlarge AutoFlip's crop window beyond
      // the target ratio. Preserve that content with the same padding effect
      // rather than stretching or silently cutting it away.
      ctx.save();
      if (solidBackgroundColor) {
        // SceneCroppingCalculator uses its interpolated solid background
        // colour for padding when BorderDetection found one in >=60% of the
        // scene. This preserves slides/gameplay rather than inventing blur.
        ctx.fillStyle = `rgb(${solidBackgroundColor.r}, ${solidBackgroundColor.g}, ${solidBackgroundColor.b})`;
        ctx.fillRect(0, 0, output.width, output.height);
      } else {
        ctx.filter = "blur(100px)";
        ctx.drawImage(frame, cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh, 0, 0, output.width, output.height);
        ctx.filter = "none";
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(0, 0, output.width, output.height);
      }
      const scale = Math.min(output.width / cropRect.sw, output.height / cropRect.sh);
      const width = cropRect.sw * scale;
      const height = cropRect.sh * scale;
      ctx.drawImage(frame, cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh, (output.width - width) / 2, (output.height - height) / 2, width, height);
      ctx.restore();
      return;
    }
    ctx.drawImage(
      frame,
      cropRect.sx,
      cropRect.sy,
      cropRect.sw,
      cropRect.sh,
      0,
      0,
      output.width,
      output.height,
    );
    return;
  }

  const rect = cropRectForCentroid(source.width, source.height, 0.5, 0.5, output.width / output.height, "normal");
  ctx.drawImage(frame, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, output.width, output.height);
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
  /** Precomputed object/motion target timeline used only by Smart Follow. */
  smartFocusTrack?: CentroidSample[];
  /** v2 AutoFlip paths, kept as rectangles to preserve the chosen crop scale. */
  smartCropAnalysis?: ClipperSmartCropBlob | null;
  /** Ids of auto-detected two-speaker regions the user turned split-screen off for. */
  disabledCollageRegionIds: string[];
  /**
   * Source-video windows making up the active clip, used to map an absolute
   * source timestamp `t` into clip-local time for caption lookup. Face
   * tracking is unaffected — it's keyed by absolute source time throughout.
   */
  segments?: ClipperClipSegmentWindow[];
}

/** Mirrors resolveCropRect's own early-outs — used to skip track derivation entirely for pad formats / manual mode. */
export function formatNeedsFaceTracking(formatDef: ClipperFormatDef, settings: ClipperSettings): boolean {
  if (formatDef.mode !== "crop") return false;
  const mode = settings.reframe.cropMode;
  return mode === "center" || mode === "smart-follow" || mode === "face-follow" || mode === "podcast-collage";
}

function drawClipperCaptions(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  output: FrameEffectSize,
  t: number,
  render: ClipperFrameContext,
): void {
  const { captions } = render.settings;
  if (!captions.enabled) return;
  if (captions.disabledForFormatIds.includes(formatDef.id)) return;

  const captionTime = render.segments?.length
    ? sourceTimeToLocalTime(render.segments, t)
    : Math.max(0, t);

  const style: SubtitleStyle = {
    position: captions.position,
    fontSize: captions.fontSize,
    fontFamily: captions.fontFamily,
    wrap: captions.wrap ? "on" : "off",
  };
  const extra: CaptionRenderExtra = {
    highlightColor: captions.highlightColor,
    uppercase: captions.uppercase,
    boxStyle: captions.boxStyle,
    boxOpacity: captions.boxOpacity,
  };

  drawPhraseAnimatedCaption(ctx, render.captionGroups, captionTime, output.width, output.height, style, extra);
}

function drawDebugFocusMarker(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  output: FrameEffectSize,
  cropRect: ClipperCropRect,
  source: FrameEffectSize,
  centroid: { x: number; y: number },
): void {
  const px = ((centroid.x * source.width - cropRect.sx) / cropRect.sw) * output.width;
  const py = ((centroid.y * source.height - cropRect.sy) / cropRect.sh) * output.height;
  ctx.save();
  ctx.strokeStyle = "#22D3EE";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, output.width * 0.04, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px - 10, py);
  ctx.lineTo(px + 10, py);
  ctx.moveTo(px, py - 10);
  ctx.lineTo(px, py + 10);
  ctx.stroke();
  ctx.restore();
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
    const focusTrack = needsTracking
      ? (render.settings.reframe.cropMode === "smart-follow" && render.smartFocusTrack?.length
        ? render.smartFocusTrack
        : (render.faceRender?.focusTrack
          ?? deriveSingleFocusTrack(samples, render.settings.reframe.facePickStrategy, render.settings.reframe.smoothing)))
      : null;
    const autoFlipRender = render.settings.reframe.cropMode === "smart-follow"
      ? resolveAutoFlipCropRender(render.smartCropAnalysis, formatDef.id, source, t)
      : undefined;
    const cropRect =
      render.settings.reframe.cropMode === "smart-follow"
        ? (autoFlipRender?.cropRect
          ?? resolveCropRect(formatDef, source, output, t, render.settings, focusTrack))
        : resolveCropRect(formatDef, source, output, t, render.settings, focusTrack);
    drawClipperPlatformFrame(
      formatDef,
      ctx,
      frame,
      source,
      output,
      cropRect,
      render.settings.reframe.cropMode === "smart-follow" ? autoFlipRender?.solidBackgroundColor : undefined,
    );

    if (showDebug && cropRect && focusTrack && focusTrack.length > 0) {
      const centroid = interpolateCentroid(focusTrack, t);
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
