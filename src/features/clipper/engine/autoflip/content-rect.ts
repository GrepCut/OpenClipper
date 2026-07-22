import type { NormalizedBox } from "../../shared/smart-crop";

export const FULL_FRAME: NormalizedBox = { x: 0, y: 0, width: 1, height: 1 };

export function validContentRect(rect: NormalizedBox | undefined): NormalizedBox {
  if (!rect || rect.width <= 0 || rect.height <= 0) return FULL_FRAME;
  const x = Math.max(0, Math.min(1, rect.x));
  const y = Math.max(0, Math.min(1, rect.y));
  const width = Math.max(0, Math.min(1 - x, rect.width));
  const height = Math.max(0, Math.min(1 - y, rect.height));
  return width > 0 && height > 0 ? { x, y, width, height } : FULL_FRAME;
}

export function intoContentRect(box: NormalizedBox, content: NormalizedBox): NormalizedBox | null {
  const left = Math.max(content.x, box.x);
  const top = Math.max(content.y, box.y);
  const right = Math.min(content.x + content.width, box.x + box.width);
  const bottom = Math.min(content.y + content.height, box.y + box.height);
  if (right <= left || bottom <= top) return null;
  return {
    x: (left - content.x) / content.width,
    y: (top - content.y) / content.height,
    width: (right - left) / content.width,
    height: (bottom - top) / content.height,
  };
}

export function intoSourceRect(rect: NormalizedBox, content: NormalizedBox): NormalizedBox {
  return {
    x: content.x + rect.x * content.width,
    y: content.y + rect.y * content.height,
    width: rect.width * content.width,
    height: rect.height * content.height,
  };
}

/**
 * Static letterbox/pillarbox bars are dead pixels: spanning them costs no
 * content but lets the crop keep the source's own bars (its native look)
 * instead of synthesizing blur padding.
 */
export function expandCropAcrossBars(
  rect: NormalizedBox,
  content: NormalizedBox,
  sourceAspect: number,
  targetAspectRatio: number,
): NormalizedBox {
  let { x, y, width, height } = rect;
  if (content.height < 1 - 1e-6) {
    y = 0;
    height = 1;
  }
  if (content.width < 1 - 1e-6) {
    x = 0;
    width = 1;
  }
  const nominalWidth = sourceAspect >= targetAspectRatio ? targetAspectRatio / sourceAspect : 1;
  const nominalHeight = sourceAspect >= targetAspectRatio ? 1 : sourceAspect / targetAspectRatio;
  if (width < nominalWidth) {
    x = Math.max(0, Math.min(1 - nominalWidth, x + width / 2 - nominalWidth / 2));
    width = nominalWidth;
  }
  if (height < nominalHeight) {
    y = Math.max(0, Math.min(1 - nominalHeight, y + height / 2 - nominalHeight / 2));
    height = nominalHeight;
  }
  return { x, y, width, height };
}
