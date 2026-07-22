import type { CaptionGroup, WordCue } from '../media/transcription-export.util';
import {
  DEFAULT_SUBTITLE_STYLE,
  subtitleStyleFromSettings,
  type SubtitleStyle,
} from '../captions/subtitle-render.util';

export { DEFAULT_SUBTITLE_STYLE, subtitleStyleFromSettings };

const HIGHLIGHT_COLOR = "#FFE566";

export type CaptionBoxStyle = "solid" | "outline" | "none";

export interface CaptionRenderExtra {
  highlightColor?: string;
  uppercase?: boolean;
  boxStyle?: CaptionBoxStyle;
  boxOpacity?: number;
}

const DEFAULT_CAPTION_EXTRA: Required<CaptionRenderExtra> = {
  highlightColor: HIGHLIGHT_COLOR,
  uppercase: false,
  boxStyle: "solid",
  boxOpacity: 0.55,
};

function findActiveWordIndex(words: WordCue[], timestamp: number): number {
  const direct = words.findIndex((word) => timestamp >= word.start && timestamp < word.end);
  if (direct !== -1) return direct;

  let fallback = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.start <= timestamp) fallback = i;
  }
  return fallback;
}

function findActiveCaptionGroup(
  groups: CaptionGroup[],
  timestamp: number,
): { group: CaptionGroup; activeWordIndex: number } | null {
  for (const group of groups) {
    if (timestamp < group.start) return null;
    if (timestamp >= group.start && timestamp < group.end) {
      return {
        group,
        activeWordIndex: findActiveWordIndex(group.words, timestamp),
      };
    }
  }

  const last = groups[groups.length - 1];
  if (last && timestamp >= last.start) {
    return {
      group: last,
      activeWordIndex: findActiveWordIndex(last.words, timestamp),
    };
  }

  return null;
}

function fontSizePx(style: SubtitleStyle, height: number): number {
  const ratio =
    style.fontSize === "sm" ? 0.04 : style.fontSize === "lg" ? 0.07 : style.fontSize === "xl" ? 0.09 : 0.055;
  return Math.round(height * ratio);
}

function fontCss(style: SubtitleStyle, fontPx: number): string {
  return style.fontFamily === "system"
    ? `bold ${fontPx}px system-ui, sans-serif`
    : `bold ${fontPx}px Arial, sans-serif`;
}

function captionBaseY(
  style: SubtitleStyle,
  height: number,
  fontPx: number,
  lineHeight: number,
  lineCount: number,
): number {
  const totalTextH = lineCount * lineHeight;
  if (style.position === "top") return fontPx * 1.4;
  if (style.position === "center") return (height - totalTextH) / 2 + fontPx;
  return height - fontPx * 1.1 - (lineCount - 1) * lineHeight;
}

function layoutWordIndicesIntoLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  words: string[],
  maxWidth: number,
): number[][] {
  const lines: number[][] = [];
  let currentLine: number[] = [];
  let currentLineWidth = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const withSpace = currentLine.length > 0 ? ` ${word}` : word;
    const addedWidth = ctx.measureText(withSpace).width;

    if (currentLine.length > 0 && currentLineWidth + addedWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = [i];
      currentLineWidth = ctx.measureText(word).width;
    } else {
      currentLineWidth += currentLine.length > 0 ? addedWidth : ctx.measureText(word).width;
      currentLine.push(i);
    }
  }

  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

function drawCaptionWordBlock(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  visible: WordCue[],
  activeWordIndex: number,
  width: number,
  height: number,
  style: SubtitleStyle,
  extra: CaptionRenderExtra = {},
): void {
  if (visible.length === 0) return;

  const { highlightColor, uppercase, boxStyle, boxOpacity } = { ...DEFAULT_CAPTION_EXTRA, ...extra };
  const visibleTexts = visible.map((word) => (uppercase ? word.text.toUpperCase() : word.text));
  const fontPx = fontSizePx(style, height);
  const lineHeight = fontPx * 1.25;
  ctx.font = fontCss(style, fontPx);

  const maxWidth = width * 0.85;
  const wordLines =
    style.wrap === "on"
      ? layoutWordIndicesIntoLines(ctx, visibleTexts, maxWidth)
      : [visibleTexts.map((_, index) => index)];

  const textLines = wordLines.map((indices) =>
    indices.map((index) => visibleTexts[index]!).join(" "),
  );
  const totalTextH = textLines.length * lineHeight;
  const baseY = captionBaseY(style, height, fontPx, lineHeight, textLines.length);

  const maxLineWidth = textLines.reduce(
    (acc, line) => Math.max(acc, ctx.measureText(line).width),
    0,
  );
  const pad = fontPx * 0.4;
  if (boxStyle !== "none") {
    const rx = width / 2 - maxLineWidth / 2 - pad;
    const ry = baseY - fontPx - pad * 0.5;
    ctx.beginPath();
    ctx.roundRect(rx, ry, maxLineWidth + pad * 2, totalTextH + pad, fontPx * 0.3);
    if (boxStyle === "solid") {
      ctx.fillStyle = `rgba(0,0,0,${boxOpacity})`;
      ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(255,255,255,${boxOpacity})`;
      ctx.lineWidth = Math.max(1, fontPx * 0.05);
      ctx.stroke();
    }
  }

  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = fontPx * 0.15;
  ctx.textAlign = "left";

  for (let lineIndex = 0; lineIndex < wordLines.length; lineIndex++) {
    const indices = wordLines[lineIndex]!;
    const lineText = textLines[lineIndex]!;
    const lineWidth = ctx.measureText(lineText).width;
    let x = width / 2 - lineWidth / 2;
    const y = baseY + lineIndex * lineHeight;

    for (let position = 0; position < indices.length; position++) {
      const wordIndex = indices[position]!;
      const word = visibleTexts[wordIndex]!;
      const drawText = position > 0 ? ` ${word}` : word;
      const isActive = wordIndex === activeWordIndex && activeWordIndex >= 0;

      ctx.fillStyle = isActive ? highlightColor : "white";
      ctx.fillText(drawText, x, y);
      x += ctx.measureText(drawText).width;
    }
  }

  ctx.textAlign = "center";
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

/** Rolling window of a few words around the active word (animated-captions tool). */
export function drawAnimatedCaption(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  words: WordCue[],
  timestamp: number,
  width: number,
  height: number,
  style: SubtitleStyle = DEFAULT_SUBTITLE_STYLE,
  extra: CaptionRenderExtra = {},
): void {
  const activeIndex = findActiveWordIndex(words, timestamp);
  if (activeIndex === -1) return;

  const windowStart = Math.max(0, activeIndex - 2);
  const windowEnd = Math.min(words.length, activeIndex + 3);
  const visible = words.slice(windowStart, windowEnd);
  const activeInWindow = activeIndex - windowStart;

  drawCaptionWordBlock(ctx, visible, activeInWindow, width, height, style, extra);
}

/** Static phrase per segment; highlight advances word-by-word until the next phrase. */
export function drawPhraseAnimatedCaption(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  groups: CaptionGroup[],
  timestamp: number,
  width: number,
  height: number,
  style: SubtitleStyle = DEFAULT_SUBTITLE_STYLE,
  extra: CaptionRenderExtra = {},
): void {
  const active = findActiveCaptionGroup(groups, timestamp);
  if (!active) return;

  drawCaptionWordBlock(
    ctx,
    active.group.words,
    active.activeWordIndex,
    width,
    height,
    style,
    extra,
  );
}
