import {
  type CaptionRenderExtra,
  drawPhraseAnimatedCaption,
} from '../../lib/captions/animated-caption-render';
import type { SubtitleStyle } from '../../lib/captions/subtitle-render';
import type { CaptionGroup } from "../../lib/media/transcription-export";
import { drawFrameContain, drawVerticalSplitFrame } from "../../lib/media/video-draw";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect";
import type { ClipperFormatDef } from "../../shared/formats";
import { cropRectForCentroid } from "../reframe";
import type { ClipperCropRect } from "../types/reframe";
import type { ClipperFrameContext, ResolvedClipperLayout } from "../types/render";
import { sourceTimeToLocalTime } from "../segmentation/clip-time";

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
  const [top, bottom] = layout.viewports;
  drawVerticalSplitFrame(ctx, frame, output, top!, bottom!);
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
      ctx.save();
      if (solidBackgroundColor) {
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
