import {
  type CaptionRenderExtra,
  drawPhraseAnimatedCaption,
} from '../../lib/captions/animated-caption-render.util';
import type { SubtitleStyle } from '../../lib/captions/subtitle-render.util';
import type { CaptionGroup } from "../../lib/media/transcription-export.util";
import { drawPrimaryPlusTwoFrame, drawVerticalSplitFrame } from "../../lib/media/video-draw.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import type { NormalizedBox } from "../../shared/smart-crop.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import { cropRectForCentroid } from "../reframe";
import type { ClipperCropRect } from "../types/reframe.types";
import type { ClipperFrameContext, ResolvedClipperLayout } from "../types/render.types";
import { sourceTimeToLocalTime } from "../segmentation/clip-time.util";

/** Intersect a pixel crop with the active content area (excludes source letterbox). */
function clampCropToContentRect(
  crop: ClipperCropRect,
  content: NormalizedBox | undefined,
  source: FrameEffectSize,
): ClipperCropRect {
  if (!content) return crop;
  if (content.x <= 1e-6 && content.y <= 1e-6 && content.width >= 1 - 1e-6 && content.height >= 1 - 1e-6) {
    return crop;
  }
  const left = content.x * source.width;
  const top = content.y * source.height;
  const right = (content.x + content.width) * source.width;
  const bottom = (content.y + content.height) * source.height;
  const sx = Math.max(crop.sx, left);
  const sy = Math.max(crop.sy, top);
  const ex = Math.min(crop.sx + crop.sw, right);
  const ey = Math.min(crop.sy + crop.sh, bottom);
  if (ex - sx < 2 || ey - sy < 2) return crop;
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

/** Cover-crop a source rect to the output aspect, then full-bleed draw (never letterbox). */
function drawCropFullBleed(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  cropRect: ClipperCropRect,
  output: FrameEffectSize,
): void {
  const targetRatio = output.width / Math.max(1, output.height);
  let { sx, sy, sw, sh } = cropRect;
  const ratio = sw / Math.max(1, sh);
  if (ratio > targetRatio + 0.001) {
    const next = sh * targetRatio;
    sx += (sw - next) / 2;
    sw = next;
  } else if (ratio < targetRatio - 0.001) {
    const next = sw / targetRatio;
    sy += (sh - next) / 2;
    sh = next;
  }
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, output.width, output.height);
}

/** Draws an explicit v3 crop/split/contain decision. */
export function drawClipperLayoutFrame(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  layout: ResolvedClipperLayout,
  contentRect?: NormalizedBox,
): void {
  if (layout.transitionFrom && layout.transitionProgress != null) {
    drawLayoutContent(formatDef, ctx, frame, source, output, layout.transitionFrom, contentRect);
    ctx.save();
    ctx.globalAlpha = layout.transitionProgress;
    drawLayoutContent(formatDef, ctx, frame, source, output, layout, contentRect);
    ctx.restore();
    return;
  }
  drawLayoutContent(formatDef, ctx, frame, source, output, layout, contentRect);
}

function drawLayoutContent(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  layout: Pick<ResolvedClipperLayout, "mode" | "viewports" | "solidBackgroundColor">,
  contentRect?: NormalizedBox,
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
      contentRect,
    );
    return;
  }
  if (layout.viewports.length >= 3) {
    drawPrimaryPlusTwoFrame(ctx, frame, output, layout.viewports[0]!, layout.viewports[1]!, layout.viewports[2]!);
    return;
  }
  const [top, bottom] = layout.viewports;
  drawVerticalSplitFrame(ctx, frame, output, top!, bottom!);
}

/** Draws one crop-framed frame — always cover-fills the output (never letterbox). */
export function drawClipperPlatformFrame(
  formatDef: ClipperFormatDef,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  cropRect?: ClipperCropRect,
  solidBackgroundColor?: { r: number; g: number; b: number },
  contentRect?: NormalizedBox,
): void {
  void formatDef;
  void solidBackgroundColor;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);

  if (cropRect) {
    drawCropFullBleed(ctx, frame, clampCropToContentRect(cropRect, contentRect, source), output);
    return;
  }

  const rect = cropRectForCentroid(source.width, source.height, 0.5, 0.5, output.width / output.height, "normal");
  drawCropFullBleed(ctx, frame, clampCropToContentRect(rect, contentRect, source), output);
}

export function drawClipperCaptions(
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

export function drawDebugFocusMarker(
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
