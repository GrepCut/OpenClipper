import type { CaptionBounds } from "../../lib/captions/animated-caption-render.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import {
  DEFAULT_CLIPPER_PARTS_OVERLAY_SETTINGS,
  type ClipperPartsOverlaySettings,
} from "../../settings/parts-overlay-settings.util";
import type { BrandingBounds } from "./branding-draw.util";
import { brandingCanvasScale, brandingMargin } from "./branding-layout.util";

const FONT_SIZE: Record<ClipperPartsOverlaySettings["size"], number> = {
  small: 36,
  medium: 48,
  large: 60,
};

const PART_COLORS: Record<ClipperPartsOverlaySettings["preset"], { text: string; background: string }> = {
  white: { text: "#000000", background: "#ffffff" },
  black: { text: "#ffffff", background: "#000000" },
  yellow: { text: "#000000", background: "#ffdf3d" },
};

type BadgePosition = { x: number; y: number; width: number };

function placeBadgeBesideBranding(
  output: FrameEffectSize,
  width: number,
  height: number,
  margin: number,
  gap: number,
  branding: BrandingBounds | null,
): BadgePosition {
  const y = Math.max(margin, output.height * 0.055);
  const centerX = (output.width - width) / 2;
  if (!branding || y >= branding.y + branding.height + gap || y + height + gap <= branding.y) {
    return { x: centerX, y, width };
  }

  const leftEdge = branding.x - gap;
  const rightEdge = branding.x + branding.width + gap;
  const rightX = output.width - margin - width;
  const freeX = [centerX, margin, rightX].find((x) => x + width <= leftEdge || x >= rightEdge);
  if (freeX != null) return { x: freeX, y, width };

  const belowY = branding.y + branding.height + gap;
  if (belowY + height <= output.height - margin) {
    return { x: centerX, y: belowY, width };
  }

  // A tall logo can leave only a narrow strip at the top. Fit the label beside it.
  const leftWidth = leftEdge - margin;
  const rightWidth = output.width - margin - rightEdge;
  return leftWidth >= rightWidth
    ? { x: margin, y, width: leftWidth }
    : { x: rightEdge, y, width: rightWidth };
}

function placePartBadge(
  output: FrameEffectSize,
  width: number,
  height: number,
  margin: number,
  gap: number,
  branding: BrandingBounds | null,
  captions: CaptionBounds | null,
): BadgePosition | null {
  const preferred = placeBadgeBesideBranding(output, width, height, margin, gap, branding);
  if (!captions) return preferred;

  const obstacles = branding ? [captions, branding] : [captions];
  const innerWidth = output.width - margin * 2;
  const bottom = margin + (output.height - margin * 2 - height);
  const isClear = (x: number, y: number, badgeWidth: number) =>
    badgeWidth > 0 && x >= margin && x <= margin + (innerWidth - badgeWidth) &&
    y >= margin && y <= bottom &&
    obstacles.every((obstacle) =>
      x <= obstacle.x - gap - badgeWidth || x >= obstacle.x + obstacle.width + gap ||
      y <= obstacle.y - gap - height || y >= obstacle.y + obstacle.height + gap,
    );
  if (isClear(preferred.x, preferred.y, preferred.width)) return preferred;

  const centerX = (output.width - width) / 2;
  const right = margin + (innerWidth - width);
  const preferredX = preferred.x + (preferred.width - width) / 2;
  const columns = [Math.min(right, Math.max(margin, preferredX)), centerX, margin, right];
  const rows = [Math.min(bottom, Math.max(margin, preferred.y)), margin, bottom];
  for (const obstacle of obstacles) {
    columns.push(obstacle.x - gap - width, obstacle.x + obstacle.width + gap);
    rows.push(obstacle.y - gap - height, obstacle.y + obstacle.height + gap);
  }

  let best: BadgePosition | null = null;
  let bestDistance = Infinity;
  let bestCenterDistance = Infinity;
  for (const y of rows) {
    for (const x of columns) {
      if (!isClear(x, y, width)) continue;
      const distance = (x - preferredX) ** 2 + (y - preferred.y) ** 2;
      const centerDistance = Math.abs(x - centerX);
      if (distance < bestDistance || (distance === bestDistance && centerDistance < bestCenterDistance)) {
        best = { x, y, width };
        bestDistance = distance;
        bestCenterDistance = centerDistance;
      }
    }
  }
  return best;
}

export function drawClipperPartBadge(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  output: FrameEffectSize,
  settings: ClipperPartsOverlaySettings,
  partNumber: number,
  branding: BrandingBounds | null,
  captions: CaptionBounds | null,
): void {
  const label = settings.label.trim() || DEFAULT_CLIPPER_PARTS_OVERLAY_SETTINGS.label;
  const text = `${label} ${partNumber}`;
  const fontSize = FONT_SIZE[settings.size] * brandingCanvasScale(output.width, output.height);
  const margin = brandingMargin(output.width, output.height);
  const paddingX = fontSize * 0.55;
  const height = fontSize * 1.6;
  const colors = PART_COLORS[settings.preset];

  ctx.save();
  try {
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const badgeWidth = Math.min(ctx.measureText(text).width + paddingX * 2, output.width - margin * 2);
    const position = placePartBadge(output, badgeWidth, height, margin, fontSize * 0.25, branding, captions);
    if (!position || position.width <= 0) return;
    const { x, y, width } = position;

    ctx.fillStyle = colors.background;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, fontSize * 0.28);
    ctx.fill();
    ctx.fillStyle = colors.text;
    const inset = Math.min(paddingX, width * 0.15);
    ctx.fillText(text, x + width / 2, y + height / 2, width - inset * 2);
  } finally {
    ctx.restore();
  }
}
