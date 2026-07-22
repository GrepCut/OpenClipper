export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
}

export type SubtitlePosition = "top" | "center" | "bottom";
export type SubtitleFontSize = "sm" | "md" | "lg" | "xl";
export type SubtitleFontFamily = "arial" | "system";
export type SubtitleWrap = "off" | "on";

export type SubtitleStyle = {
  position: SubtitlePosition;
  fontSize: SubtitleFontSize;
  fontFamily: SubtitleFontFamily;
  wrap: SubtitleWrap;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  position: "bottom",
  fontSize: "md",
  fontFamily: "arial",
  wrap: "off",
};

export const PREVIEW_FALLBACK_TEXT = "Sample SRT subtitle preview";

const FONT_SIZE_RATIO: Record<SubtitleFontSize, number> = {
  sm: 0.04,
  md: 0.055,
  lg: 0.07,
  xl: 0.09,
};

function parseTimestamp(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

export function parseSRT(raw: string): SubtitleEntry[] {
  return raw
    .trim()
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.trim().split("\n");
      const ti = lines.findIndex((l) => l.includes("-->"));
      if (ti === -1) return [];
      const [startStr, endStr] = lines[ti].split("-->");
      const start = parseTimestamp(startStr.trim());
      const end = parseTimestamp(endStr.trim());
      const text = lines
        .slice(ti + 1)
        .join("\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      return text ? [{ start, end, text }] : [];
    });
}

export function subtitleStyleFromSettings(
  settings?: Readonly<Record<string, string>>,
): SubtitleStyle {
  const position = settings?.position;
  const fontSize = settings?.fontSize;
  const fontFamily = settings?.fontFamily;
  const wrap = settings?.wrap;

  return {
    position:
      position === "top" || position === "center" || position === "bottom"
        ? position
        : DEFAULT_SUBTITLE_STYLE.position,
    fontSize:
      fontSize === "sm" || fontSize === "md" || fontSize === "lg" || fontSize === "xl"
        ? fontSize
        : DEFAULT_SUBTITLE_STYLE.fontSize,
    fontFamily:
      fontFamily === "arial" || fontFamily === "system"
        ? fontFamily
        : DEFAULT_SUBTITLE_STYLE.fontFamily,
    wrap: wrap === "on" || wrap === "off" ? wrap : DEFAULT_SUBTITLE_STYLE.wrap,
  };
}

function fontCss(family: SubtitleFontFamily, fontSizePx: number): string {
  if (family === "system") {
    return `bold ${fontSizePx}px system-ui, sans-serif`;
  }
  return `bold ${fontSizePx}px Arial, sans-serif`;
}

function wrapTextToLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const word = words[i]!;
      const candidate = `${line} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
}

function resolveLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  w: number,
  style: SubtitleStyle,
): string[] {
  if (style.wrap === "on") {
    return wrapTextToLines(ctx, text, w * 0.85);
  }
  return text.split("\n");
}

function getBaseY(
  position: SubtitlePosition,
  h: number,
  fontSizePx: number,
  lineHeight: number,
  lineCount: number,
): number {
  const totalTextH = lineCount * lineHeight;
  if (position === "top") return fontSizePx * 1.4;
  if (position === "center") return (h - totalTextH) / 2 + fontSizePx;
  return h - fontSizePx * 1.1 - (lineCount - 1) * lineHeight;
}

export function drawSubtitleText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
  style: SubtitleStyle = DEFAULT_SUBTITLE_STYLE,
): void {
  const fontSizePx = Math.round(h * FONT_SIZE_RATIO[style.fontSize]);
  ctx.font = fontCss(style.fontFamily, fontSizePx);
  ctx.textAlign = "center";
  const lineHeight = fontSizePx * 1.25;
  const lines = resolveLines(ctx, text, w, style);
  const totalTextH = lines.length * lineHeight;
  const baseY = getBaseY(style.position, h, fontSizePx, lineHeight, lines.length);

  const maxWidth = lines.reduce((acc, line) => Math.max(acc, ctx.measureText(line).width), 0);
  const pad = fontSizePx * 0.4;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  const rx = w / 2 - maxWidth / 2 - pad;
  const ry = baseY - fontSizePx - pad * 0.5;
  ctx.roundRect(rx, ry, maxWidth + pad * 2, totalTextH + pad, fontSizePx * 0.3);
  ctx.fill();

  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = fontSizePx * 0.15;
  ctx.fillStyle = "white";
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, baseY + i * lineHeight);
  });
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}
