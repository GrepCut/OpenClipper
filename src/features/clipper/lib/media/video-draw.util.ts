/** Canvas 2D helpers shared by frame-baking video tools. */

export interface VideoSize {
  width: number;
  height: number;
}

export function evenInt(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export const ASPECT_PRESETS: { id: string; label: string; ratio: number }[] = [
  { id: "16-9", label: "16:9", ratio: 16 / 9 },
  { id: "9-16", label: "9:16", ratio: 9 / 16 },
  { id: "1-1", label: "1:1", ratio: 1 },
  { id: "4-5", label: "4:5", ratio: 4 / 5 },
];

export function aspectRatioFromId(id: string): number {
  return ASPECT_PRESETS.find((preset) => preset.id === id)?.ratio ?? 16 / 9;
}

/** Output dimensions for crop (cover) or pad (contain / letterbox) to a target aspect. */
export function outputSizeForAspect(
  source: VideoSize,
  targetRatio: number,
  mode: "crop" | "pad",
): VideoSize {
  const srcRatio = source.width / source.height;

  if (mode === "crop") {
    if (srcRatio > targetRatio) {
      return { width: evenInt(source.height * targetRatio), height: evenInt(source.height) };
    }
    return { width: evenInt(source.width), height: evenInt(source.width / targetRatio) };
  }

  if (srcRatio > targetRatio) {
    return { width: evenInt(source.width), height: evenInt(source.width / targetRatio) };
  }
  return { width: evenInt(source.height * targetRatio), height: evenInt(source.height) };
}

export function drawFrameCover(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  imgW: number,
  imgH: number,
): void {
  const imgRatio = imgW / imgH;
  const targetRatio = dw / dh;

  let sx = 0;
  let sy = 0;
  let sw = imgW;
  let sh = imgH;

  if (imgRatio > targetRatio) {
    sw = imgH * targetRatio;
    sx = (imgW - sw) / 2;
  } else {
    sh = imgW / targetRatio;
    sy = (imgH - sh) / 2;
  }

  ctx.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
}

export function drawFrameContain(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: CanvasImageSource,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
): void {
  const imgRatio = imgW / imgH;
  const boxRatio = boxW / boxH;

  let dw = boxW;
  let dh = boxH;
  if (imgRatio > boxRatio) {
    dh = boxW / imgRatio;
  } else {
    dw = boxH * imgRatio;
  }

  const dx = boxX + (boxW - dw) / 2;
  const dy = boxY + (boxH - dh) / 2;
  ctx.drawImage(frame, dx, dy, dw, dh);
}

export function roundRectPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export interface SplitCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Draws a top/bottom split frame with an optional center divider. */
export function drawVerticalSplitFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  output: VideoSize,
  topCrop: SplitCropRect,
  bottomCrop: SplitCropRect,
  dividerPx = 3,
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);
  const topHeight = evenInt(output.height / 2);
  const bottomHeight = output.height - topHeight;
  ctx.drawImage(frame, topCrop.sx, topCrop.sy, topCrop.sw, topCrop.sh, 0, 0, output.width, topHeight);
  ctx.drawImage(
    frame,
    bottomCrop.sx,
    bottomCrop.sy,
    bottomCrop.sw,
    bottomCrop.sh,
    0,
    topHeight,
    output.width,
    bottomHeight,
  );
  if (dividerPx > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(0, topHeight - dividerPx / 2, output.width, dividerPx);
  }
}

/**
 * Renders a full-frame editorial three-up. Portrait keeps the primary panel
 * above two secondaries; square and landscape place it left of a stacked pair.
 */
export function drawPrimaryPlusTwoFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  output: VideoSize,
  primaryCrop: SplitCropRect,
  secondaryOneCrop: SplitCropRect,
  secondaryTwoCrop: SplitCropRect,
  dividerPx = 3,
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);
  if (output.width / output.height < 1) {
    const primaryHeight = evenInt(output.height / 2);
    const lowerHeight = output.height - primaryHeight;
    const leftWidth = evenInt(output.width / 2);
    const rightWidth = output.width - leftWidth;
    ctx.drawImage(frame, primaryCrop.sx, primaryCrop.sy, primaryCrop.sw, primaryCrop.sh, 0, 0, output.width, primaryHeight);
    ctx.drawImage(frame, secondaryOneCrop.sx, secondaryOneCrop.sy, secondaryOneCrop.sw, secondaryOneCrop.sh, 0, primaryHeight, leftWidth, lowerHeight);
    ctx.drawImage(frame, secondaryTwoCrop.sx, secondaryTwoCrop.sy, secondaryTwoCrop.sw, secondaryTwoCrop.sh, leftWidth, primaryHeight, rightWidth, lowerHeight);
    if (dividerPx > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, primaryHeight - dividerPx / 2, output.width, dividerPx);
      ctx.fillRect(leftWidth - dividerPx / 2, primaryHeight, dividerPx, lowerHeight);
    }
    return;
  }
  const primaryWidth = evenInt(output.width * 0.6);
  const secondaryWidth = output.width - primaryWidth;
  const upperHeight = evenInt(output.height / 2);
  const lowerHeight = output.height - upperHeight;
  ctx.drawImage(frame, primaryCrop.sx, primaryCrop.sy, primaryCrop.sw, primaryCrop.sh, 0, 0, primaryWidth, output.height);
  ctx.drawImage(frame, secondaryOneCrop.sx, secondaryOneCrop.sy, secondaryOneCrop.sw, secondaryOneCrop.sh, primaryWidth, 0, secondaryWidth, upperHeight);
  ctx.drawImage(frame, secondaryTwoCrop.sx, secondaryTwoCrop.sy, secondaryTwoCrop.sw, secondaryTwoCrop.sh, primaryWidth, upperHeight, secondaryWidth, lowerHeight);
  if (dividerPx > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(primaryWidth - dividerPx / 2, 0, dividerPx, output.height);
    ctx.fillRect(primaryWidth, upperHeight - dividerPx / 2, secondaryWidth, dividerPx);
  }
}
