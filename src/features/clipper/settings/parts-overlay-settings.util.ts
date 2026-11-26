export const CLIPPER_PARTS_OVERLAY_SIZES = ["small", "medium", "large"] as const;
export const CLIPPER_PARTS_OVERLAY_PRESETS = ["white", "black", "yellow"] as const;
export const CLIPPER_PARTS_OVERLAY_LABEL_MAX_LENGTH = 32;

export interface ClipperPartsOverlaySettings {
  enabled: boolean;
  label: string;
  size: (typeof CLIPPER_PARTS_OVERLAY_SIZES)[number];
  preset: (typeof CLIPPER_PARTS_OVERLAY_PRESETS)[number];
}

export const DEFAULT_CLIPPER_PARTS_OVERLAY_SETTINGS: ClipperPartsOverlaySettings = {
  enabled: false,
  label: "Part",
  size: "medium",
  preset: "white",
};

export function mergeClipperPartsOverlaySettings(
  base: ClipperPartsOverlaySettings,
  partial: Partial<ClipperPartsOverlaySettings> | undefined,
): ClipperPartsOverlaySettings {
  if (!partial) return base;
  return {
    enabled: typeof partial.enabled === "boolean" ? partial.enabled : base.enabled,
    label: typeof partial.label === "string"
      ? partial.label.slice(0, CLIPPER_PARTS_OVERLAY_LABEL_MAX_LENGTH)
      : base.label,
    size: partial.size && CLIPPER_PARTS_OVERLAY_SIZES.includes(partial.size) ? partial.size : base.size,
    preset: partial.preset && CLIPPER_PARTS_OVERLAY_PRESETS.includes(partial.preset) ? partial.preset : base.preset,
  };
}
