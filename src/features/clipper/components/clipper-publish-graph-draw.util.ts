import {
  getExportNodeStatus,
  type ExportNodeStatus,
} from "../persistence/clipper-export-social.util";
import type { PublishGraphNode } from "../shared/clipper-publish-graph.util";
import { PROJECT_THUMB_MAX_DIMENSION } from "../shared/clipper-publish-graph.util";

const STATUS_DOT_COLORS: Record<ExportNodeStatus, string> = {
  incomplete: "#ef4444",
  ready: "#eab308",
  published: "#22c55e",
};

const PROJECT_LABEL_GAP = 5;
const PROJECT_BORDER_RADIUS = 8;
const EXPORT_NODE_RADIUS = 18;
const OWNER_NODE_RADIUS = 24;
const DEFAULT_THUMB_WIDTH = PROJECT_THUMB_MAX_DIMENSION;
const DEFAULT_THUMB_HEIGHT = Math.round((PROJECT_THUMB_MAX_DIMENSION * 9) / 16);

function fitImageInBox(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  return {
    width: imageWidth * scale,
    height: imageHeight * scale,
  };
}

interface ClipperGraphTheme {
  surface: { elevated: string };
  background: { card: string };
  border: { primary: string };
  text: { primary: string };
}

function getProjectThumbSize(
  node: PublishGraphNode,
  thumbnail?: HTMLCanvasElement,
): { width: number; height: number } {
  if (thumbnail) {
    return { width: thumbnail.width, height: thumbnail.height };
  }
  return {
    width: node.thumbWidth ?? DEFAULT_THUMB_WIDTH,
    height: node.thumbHeight ?? DEFAULT_THUMB_HEIGHT,
  };
}

function truncateCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawStatusDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  strokeColor: string,
  globalScale: number,
): void {
  const dotR = 5 / globalScale;
  ctx.beginPath();
  ctx.arc(x, y, dotR, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5 / globalScale;
  ctx.stroke();
}

export function getProjectCardHeight(
  node: PublishGraphNode,
  labelFontSize: number,
  thumbnail?: HTMLCanvasElement,
): number {
  const { height } = getProjectThumbSize(node, thumbnail);
  return height + PROJECT_LABEL_GAP + labelFontSize + 2;
}

export function getNodeHitRadius(
  node: PublishGraphNode,
  labelFontSize = 11,
  thumbnail?: HTMLCanvasElement,
): number {
  if (node.type === "owner") {
    return OWNER_NODE_RADIUS + 12;
  }
  if (node.type === "project") {
    const { width } = getProjectThumbSize(node, thumbnail);
    return Math.max(width, getProjectCardHeight(node, labelFontSize, thumbnail)) / 2 + 4;
  }
  return EXPORT_NODE_RADIUS + 4;
}

export function drawOwnerNode(
  node: PublishGraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  theme: ClipperGraphTheme,
  isSelected: boolean,
): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const labelFontSize = Math.max(9, 11 / globalScale);
  const initials = node.label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

  ctx.beginPath();
  ctx.arc(x, y - 8, OWNER_NODE_RADIUS, 0, 2 * Math.PI, false);
  ctx.fillStyle = theme.surface.elevated;
  ctx.fill();
  ctx.strokeStyle = isSelected ? "#3b82f6" : theme.border.primary;
  ctx.lineWidth = isSelected ? 2.5 / globalScale : 1.4 / globalScale;
  ctx.stroke();

  ctx.fillStyle = theme.text.primary;
  ctx.font = `700 ${Math.max(10, 13 / globalScale)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, x, y - 8);

  ctx.font = `600 ${labelFontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(truncateCanvasText(ctx, node.label, OWNER_NODE_RADIUS * 2 + 16), x, y + 18);
}

export function drawProjectNode(
  node: PublishGraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  theme: ClipperGraphTheme,
  thumbnail?: HTMLCanvasElement,
  isSelected = false,
): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const { width: thumbWidth, height: thumbHeight } = getProjectThumbSize(node, thumbnail);
  const labelFontSize = Math.max(9, 11 / globalScale);
  const totalHeight = getProjectCardHeight(node, labelFontSize, thumbnail);
  const thumbX = x - thumbWidth / 2;
  const thumbY = y - totalHeight / 2;

  roundRectPath(ctx, thumbX, thumbY, thumbWidth, thumbHeight, PROJECT_BORDER_RADIUS);
  ctx.fillStyle = theme.surface.elevated;
  ctx.fill();
  ctx.strokeStyle = isSelected ? "#3b82f6" : theme.border.primary;
  ctx.lineWidth = isSelected ? 2.5 / globalScale : 1.2 / globalScale;
  ctx.stroke();

  if (thumbnail) {
    ctx.save();
    roundRectPath(ctx, thumbX, thumbY, thumbWidth, thumbHeight, PROJECT_BORDER_RADIUS);
    ctx.clip();
    ctx.drawImage(thumbnail, thumbX, thumbY, thumbWidth, thumbHeight);
    ctx.restore();
    roundRectPath(ctx, thumbX, thumbY, thumbWidth, thumbHeight, PROJECT_BORDER_RADIUS);
    ctx.strokeStyle = theme.border.primary;
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();
  }

  ctx.fillStyle = theme.text.primary;
  ctx.font = `600 ${labelFontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(
    truncateCanvasText(ctx, node.label, thumbWidth + 10),
    x,
    thumbY + thumbHeight + PROJECT_LABEL_GAP,
  );
}

export function drawExportNode(
  node: PublishGraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  theme: ClipperGraphTheme,
  selectedExportId: string | null,
  loadPlatformLogo: (platform: PublishGraphNode["platform"]) => HTMLImageElement | null,
): void {
  const isSelected = node.id === selectedExportId;
  const radius = EXPORT_NODE_RADIUS;

  ctx.beginPath();
  ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false);
  ctx.fillStyle = theme.background.card;
  ctx.fill();
  ctx.strokeStyle = isSelected ? "#3b82f6" : theme.border.primary;
  ctx.lineWidth = isSelected ? 2.5 / globalScale : 1.2 / globalScale;
  ctx.stroke();

  const platforms =
    node.badgePlatforms && node.badgePlatforms.length > 0
      ? node.badgePlatforms
      : node.platform
        ? [node.platform]
        : [];

  if (platforms.length === 1) {
    const logo = loadPlatformLogo(platforms[0]);
    if (logo) {
      const innerDiameter = (radius - 2) * 2;
      const fitted = fitImageInBox(
        logo.naturalWidth,
        logo.naturalHeight,
        innerDiameter,
        innerDiameter,
      );
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius - 2, 0, 2 * Math.PI);
      ctx.clip();
      ctx.drawImage(
        logo,
        (node.x ?? 0) - fitted.width / 2,
        (node.y ?? 0) - fitted.height / 2,
        fitted.width,
        fitted.height,
      );
      ctx.restore();
    }
  } else if (platforms.length > 1) {
    const logos = platforms
      .map((platform) => loadPlatformLogo(platform))
      .filter((logo): logo is HTMLImageElement => Boolean(logo));
    if (logos.length > 0) {
      const slot = Math.min(radius * 1.05, (radius * 1.6) / logos.length);
      const totalWidth = logos.length * slot - (logos.length - 1) * slot * 0.25;
      let cursorX = (node.x ?? 0) - totalWidth / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius - 1, 0, 2 * Math.PI);
      ctx.clip();
      for (const logo of logos) {
        const fitted = fitImageInBox(logo.naturalWidth, logo.naturalHeight, slot, slot);
        ctx.drawImage(
          logo,
          cursorX + (slot - fitted.width) / 2,
          (node.y ?? 0) - fitted.height / 2,
          fitted.width,
          fitted.height,
        );
        cursorX += slot * 0.75;
      }
      ctx.restore();
    }
  }

  const status = node.exportItem
    ? getExportNodeStatus(node.exportItem)
    : "incomplete";
  const bx = (node.x ?? 0) + radius - 4 / globalScale;
  const by = (node.y ?? 0) + radius - 4 / globalScale;
  drawStatusDot(
    ctx,
    bx,
    by,
    STATUS_DOT_COLORS[status],
    theme.background.card,
    globalScale,
  );
}

export function paintNodeHitArea(
  node: PublishGraphNode,
  color: string,
  ctx: CanvasRenderingContext2D,
  thumbnail?: HTMLCanvasElement,
): void {
  const radius = getNodeHitRadius(node, 11, thumbnail);
  ctx.fillStyle = color;
  if (node.type === "project") {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const width = radius * 2;
    const height = radius * 2;
    ctx.fillRect(x - radius, y - radius, width, height);
    return;
  }
  ctx.beginPath();
  ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
  ctx.fill();
}
