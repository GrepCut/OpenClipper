import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import type { ClipperBrandingSettings } from "../../settings/branding-settings.util";
import { getBrandingLogo } from "./branding-logo-cache.util";
import {
  brandingCanvasScale,
  brandingMargin,
  brandingTextFontSize,
  logoDrawSize,
  resolveBrandingBox,
} from "./branding-layout.util";

type BrandingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface BrandingBounds extends FrameEffectSize {
  x: number;
  y: number;
}

export function drawClipperBranding(
  ctx: BrandingContext,
  output: FrameEffectSize,
  branding: ClipperBrandingSettings,
): BrandingBounds | null {
  if (branding.kind === "off" || branding.opacity === 0) return null;

  const canvasScale = brandingCanvasScale(output.width, output.height);
  const margin = brandingMargin(output.width, output.height);
  const place = (width: number, height: number) =>
    resolveBrandingBox(branding.offsetX, branding.offsetY, output.width, output.height, width, height, margin);

  if (branding.kind === "logo") {
    const logo = getBrandingLogo(branding.imagePath);
    if (!logo) return null;
    const size = logoDrawSize(logo.width, logo.height, branding.logoWidthRatio, canvasScale);
    const origin = place(size.width, size.height);
    ctx.save();
    ctx.globalAlpha = branding.opacity;
    ctx.drawImage(logo, origin.x, origin.y, size.width, size.height);
    ctx.restore();
    return { ...origin, ...size };
  }

  const text = branding.text.trim();
  if (!text) return null;
  const fontSize = brandingTextFontSize(branding.logoWidthRatio, canvasScale);
  const maxTextWidth = Math.max(16, output.width - margin * 2);

  ctx.save();
  ctx.globalAlpha = branding.opacity;
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  const textWidth = Math.min(maxTextWidth, ctx.measureText(text).width);
  const origin = place(textWidth, fontSize);
  ctx.fillText(text, origin.x + textWidth / 2, origin.y, maxTextWidth);
  ctx.restore();
  return { ...origin, width: textWidth, height: fontSize };
}
