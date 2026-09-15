import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import type { ClipperBrandingSettings } from "../../settings/branding-settings.util";
import { getBrandingLogo } from "./branding-logo-cache.util";
import {
  brandingCanvasScale,
  brandingTextFontSize,
  logoDrawSize,
  resolveBrandingBox,
} from "./branding-layout.util";

const BRANDING_MARGIN_RATIO = 0.045;

type BrandingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawClipperBranding(
  ctx: BrandingContext,
  output: FrameEffectSize,
  branding: ClipperBrandingSettings,
): void {
  if (branding.kind === "off") return;

  const canvasScale = brandingCanvasScale(output.width, output.height);
  const margin = Math.max(8, Math.min(output.width, output.height) * BRANDING_MARGIN_RATIO);
  const place = (width: number, height: number) =>
    resolveBrandingBox(branding.offsetX, branding.offsetY, output.width, output.height, width, height, margin);

  if (branding.kind === "logo") {
    const logo = getBrandingLogo(branding.imagePath);
    if (!logo) return;
    const size = logoDrawSize(logo.width, logo.height, branding.logoWidthRatio, canvasScale);
    const origin = place(size.width, size.height);
    ctx.save();
    ctx.globalAlpha = branding.opacity;
    ctx.drawImage(logo, origin.x, origin.y, size.width, size.height);
    ctx.restore();
    return;
  }

  const text = branding.text.trim();
  if (!text) return;
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
}
