import { clamp } from "../lib/math.util";

export const CLIPPER_BRANDING_KINDS = ["logo", "text", "off"] as const;

export type ClipperBrandingKind = (typeof CLIPPER_BRANDING_KINDS)[number];

/** Logo width (and text size) as a fraction of the 1080 px reference short side. */
export const BRANDING_LOGO_WIDTH_MIN = 0.1;
export const BRANDING_LOGO_WIDTH_MAX = 0.4;

export interface ClipperBrandingSettings {
  kind: ClipperBrandingKind;
  imagePath: string | null;
  offsetX: number;
  offsetY: number;
  opacity: number;
  logoWidthRatio: number;
  text: string;
}

export const DEFAULT_CLIPPER_BRANDING_SETTINGS: ClipperBrandingSettings = {
  kind: "off",
  imagePath: null,
  offsetX: 1,
  offsetY: 0,
  opacity: 1,
  logoWidthRatio: 0.18,
  text: "",
};

function isClipperBrandingKind(value: unknown): value is ClipperBrandingKind {
  return (CLIPPER_BRANDING_KINDS as readonly unknown[]).includes(value);
}

function mergeUnitRatio(partial: unknown, base: number): number {
  return typeof partial === "number" ? clamp(partial, 0, 1) : base;
}

export function mergeClipperBrandingSettings(
  base: ClipperBrandingSettings,
  partial: Partial<ClipperBrandingSettings> | null | undefined,
): ClipperBrandingSettings {
  if (!partial) return base;
  return {
    kind: isClipperBrandingKind(partial.kind) ? partial.kind : base.kind,
    imagePath:
      partial.imagePath === undefined
        ? base.imagePath
        : typeof partial.imagePath === "string" && partial.imagePath.length > 0
          ? partial.imagePath
          : null,
    offsetX: mergeUnitRatio(partial.offsetX, base.offsetX),
    offsetY: mergeUnitRatio(partial.offsetY, base.offsetY),
    opacity: mergeUnitRatio(partial.opacity, base.opacity),
    logoWidthRatio:
      typeof partial.logoWidthRatio === "number"
        ? clamp(partial.logoWidthRatio, BRANDING_LOGO_WIDTH_MIN, BRANDING_LOGO_WIDTH_MAX)
        : base.logoWidthRatio,
    text: typeof partial.text === "string" ? partial.text : base.text,
  };
}