import { DEFAULT_CLIPPER_BRANDING_SETTINGS } from "../../settings/branding-settings.util";

const BRANDING_TEXT_SIZE_AT_DEFAULT_LOGO = 0.032;

/** 1080p short side — logo/text pixels are defined here, not from the current canvas. */
const BRANDING_PIXEL_REF = 1080;

export function resolveBrandingBox(
  offsetX: number,
  offsetY: number,
  outputWidth: number,
  outputHeight: number,
  boxWidth: number,
  boxHeight: number,
  margin: number,
): { x: number; y: number } {
  const travelX = Math.max(0, outputWidth - margin * 2 - boxWidth);
  const travelY = Math.max(0, outputHeight - margin * 2 - boxHeight);
  return {
    x: margin + travelX * offsetX,
    y: margin + travelY * offsetY,
  };
}

/**
 * Scales branding with the output's short side, so 1080×1920, 1920×1080 and 1080×1080
 * all scale to 1 at 1080p and display-size previews keep the exported proportions.
 */
export function brandingCanvasScale(outputWidth: number, outputHeight: number): number {
  return Math.min(outputWidth, outputHeight) / BRANDING_PIXEL_REF;
}

export function brandingTextFontSize(sizeRatio: number, canvasScale: number): number {
  const scale = sizeRatio / DEFAULT_CLIPPER_BRANDING_SETTINGS.logoWidthRatio;
  return Math.max(12, BRANDING_PIXEL_REF * BRANDING_TEXT_SIZE_AT_DEFAULT_LOGO * scale * canvasScale);
}

export function logoDrawSize(
  imageWidth: number,
  imageHeight: number,
  widthRatio: number,
  canvasScale: number,
): { width: number; height: number } {
  const width = Math.max(8, BRANDING_PIXEL_REF * widthRatio * canvasScale);
  const aspect = imageHeight / Math.max(1, imageWidth);
  return { width, height: Math.max(8, width * aspect) };
}
