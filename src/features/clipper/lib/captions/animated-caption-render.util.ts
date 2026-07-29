import type { CaptionGroup, WordCue } from "../media/transcription-export.util";
import {
  resolveCaptionPreset,
  type CaptionFontFamily,
  type CaptionPresetDefinition,
  type ClipperCaptionPresetId,
} from "./caption-presets.util";

type CaptionContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type CaptionContextWithTypography = CaptionContext & {
  letterSpacing?: string;
  filter?: string;
};

interface CaptionWordPlacement {
  index: number;
  text: string;
  x: number;
  width: number;
}

interface CaptionLineLayout {
  baseline: number;
  width: number;
  words: CaptionWordPlacement[];
}

interface CaptionLayout {
  fontPx: number;
  lineHeight: number;
  lines: CaptionLineLayout[];
  top: number;
  bottom: number;
  maxLineWidth: number;
}

interface WordMotion {
  opacity: number;
  scale: number;
  blurEm: number;
  translateYEm: number;
}

const captionLayoutCache = new WeakMap<WordCue[], Map<string, CaptionLayout>>();

export function clampCaptionProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function captionProgress(
  timestamp: number,
  start: number,
  end: number,
): number {
  if (end <= start) return timestamp >= end ? 1 : 0;
  return clampCaptionProgress((timestamp - start) / (end - start));
}

export function captionEntranceProgress(
  timestamp: number,
  start: number,
  durationSec: number,
): number {
  if (durationSec <= 0) return timestamp >= start ? 1 : 0;
  return clampCaptionProgress((timestamp - start) / durationSec);
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function easeOutBack(progress: number): number {
  const overshoot = 1.70158;
  const shifted = progress - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

export function findActiveCaptionWordIndex(
  words: WordCue[],
  timestamp: number,
): number {
  return words.findIndex(
    (word) => timestamp >= word.start && timestamp < word.end,
  );
}

export function findActiveCaptionGroup(
  groups: CaptionGroup[],
  timestamp: number,
): { group: CaptionGroup; activeWordIndex: number } | null {
  for (const group of groups) {
    if (timestamp >= group.start && timestamp < group.end) {
      return {
        group,
        activeWordIndex: findActiveCaptionWordIndex(group.words, timestamp),
      };
    }
  }
  return null;
}

function fontCss(preset: CaptionPresetDefinition, fontPx: number): string {
  return customFontCss(
    preset.fontFamily,
    preset.fontWeight,
    preset.fontStyle,
    fontPx,
  );
}

function customFontCss(
  family: CaptionFontFamily,
  weight: CaptionPresetDefinition["fontWeight"],
  style: CaptionPresetDefinition["fontStyle"],
  fontPx: number,
): string {
  return `${style} ${weight} ${fontPx}px "${family} Latin Extended", "${family}", "Inter Latin Extended", "Inter", system-ui, sans-serif`;
}

function applyFont(
  ctx: CaptionContext,
  preset: CaptionPresetDefinition,
  fontPx: number,
): void {
  ctx.font = fontCss(preset, fontPx);
  const typographyCtx = ctx as CaptionContextWithTypography;
  if ("letterSpacing" in typographyCtx) {
    typographyCtx.letterSpacing = `${preset.letterSpacingEm}em`;
  }
}

function applyCustomFont(
  ctx: CaptionContext,
  family: CaptionFontFamily,
  weight: CaptionPresetDefinition["fontWeight"],
  style: CaptionPresetDefinition["fontStyle"],
  fontPx: number,
  letterSpacingEm = 0,
): void {
  ctx.font = customFontCss(family, weight, style, fontPx);
  const typographyCtx = ctx as CaptionContextWithTypography;
  if ("letterSpacing" in typographyCtx) {
    typographyCtx.letterSpacing = `${letterSpacingEm}em`;
  }
}

function layoutWordsIntoLines(
  ctx: CaptionContext,
  words: string[],
  maxWidth: number,
  wordGap: number,
): number[][] {
  const lines: number[][] = [];
  let currentLine: number[] = [];
  let currentWidth = 0;

  for (let index = 0; index < words.length; index++) {
    const wordWidth = ctx.measureText(words[index]!).width;
    const addedWidth = wordWidth + (currentLine.length > 0 ? wordGap : 0);
    if (currentLine.length > 0 && currentWidth + addedWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = [index];
      currentWidth = wordWidth;
    } else {
      currentLine.push(index);
      currentWidth += addedWidth;
    }
  }

  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

function captionWordScale(preset: CaptionPresetDefinition): number {
  return Math.max(1, preset.activeScale, preset.entranceScaleFrom);
}

function captionGroupScale(preset: CaptionPresetDefinition): number {
  return Math.max(1, preset.groupScaleTo ?? 1);
}

function captionHorizontalPaddingEm(preset: CaptionPresetDefinition): number {
  const textEffectPadding =
    preset.outlineWidthEm +
    preset.shadowBlurEm +
    Math.abs(preset.shadowOffsetXEm);
  const platePadding =
    preset.plateStyle === "group" ? preset.platePaddingXEm : 0;
  const activePadding =
    preset.activeEffect === "gradient-pill" ? preset.activePaddingXEm : 0;
  return Math.max(textEffectPadding, platePadding, activePadding);
}

function fitCaptionFontPx(
  ctx: CaptionContext,
  visibleTexts: readonly string[],
  width: number,
  height: number,
  preset: CaptionPresetDefinition,
): number {
  const baseFontPx = Math.max(12, Math.round(height * preset.fontSizeRatio));
  applyFont(ctx, preset, baseFontPx);
  const longestWordWidth = Math.max(
    ...visibleTexts.map((text) => ctx.measureText(text).width),
    0,
  );
  if (longestWordWidth <= 0) return baseFontPx;

  const paintedWordWidth =
    longestWordWidth * captionWordScale(preset) +
    baseFontPx * captionHorizontalPaddingEm(preset) * 2;
  const availableWidth =
    (width * preset.maxWidthRatio) / captionGroupScale(preset);
  if (paintedWordWidth <= availableWidth) return baseFontPx;

  const fittedFontPx = Math.max(
    1,
    Math.floor((baseFontPx * availableWidth) / paintedWordWidth),
  );
  applyFont(ctx, preset, fittedFontPx);
  return fittedFontPx;
}

function buildCaptionLayout(
  ctx: CaptionContext,
  words: WordCue[],
  width: number,
  height: number,
  preset: CaptionPresetDefinition,
): CaptionLayout {
  const visibleTexts = words.map((word) =>
    preset.uppercase ? word.text.toLocaleUpperCase() : word.text,
  );
  const fontPx = fitCaptionFontPx(ctx, visibleTexts, width, height, preset);
  const lineHeight = fontPx * preset.lineHeightRatio;
  const wordGap = fontPx * preset.wordGapEm;
  const horizontalPadding = fontPx * captionHorizontalPaddingEm(preset);
  const maxLineWidth = Math.max(
    1,
    (width * preset.maxWidthRatio) / captionGroupScale(preset) -
      horizontalPadding * 2,
  );
  const wordLines = layoutWordsIntoLines(
    ctx,
    visibleTexts,
    maxLineWidth,
    wordGap,
  );
  const totalHeight = wordLines.length * lineHeight;
  const top = height * preset.anchorY - totalHeight / 2;

  const lines = wordLines.map((indices, lineIndex): CaptionLineLayout => {
    const widths = indices.map(
      (index) => ctx.measureText(visibleTexts[index]!).width,
    );
    const lineWidth =
      widths.reduce((sum, wordWidth) => sum + wordWidth, 0) +
      Math.max(0, indices.length - 1) * wordGap;
    let x = width / 2 - lineWidth / 2;
    const placements = indices.map((index, wordIndex): CaptionWordPlacement => {
      const placement = {
        index,
        text: visibleTexts[index]!,
        x,
        width: widths[wordIndex]!,
      };
      x += widths[wordIndex]! + wordGap;
      return placement;
    });

    return {
      baseline: top + fontPx + lineIndex * lineHeight,
      width: lineWidth,
      words: placements,
    };
  });

  return {
    fontPx,
    lineHeight,
    lines,
    top,
    bottom: top + totalHeight,
    maxLineWidth: Math.max(...lines.map((line) => line.width), 0),
  };
}

function getCaptionLayout(
  ctx: CaptionContext,
  words: WordCue[],
  width: number,
  height: number,
  preset: CaptionPresetDefinition,
): CaptionLayout {
  let cachedForWords = captionLayoutCache.get(words);
  if (!cachedForWords) {
    cachedForWords = new Map();
    captionLayoutCache.set(words, cachedForWords);
  }
  const textSignature = words.map((word) => word.text).join("\u0000");
  const key = [
    preset.id,
    preset.fontFamily,
    preset.fontWeight,
    preset.fontStyle,
    preset.fontSizeRatio,
    preset.lineHeightRatio,
    preset.letterSpacingEm,
    preset.wordGapEm,
    preset.uppercase,
    preset.anchorY,
    preset.maxWidthRatio,
    preset.outlineWidthEm,
    preset.shadowBlurEm,
    preset.shadowOffsetXEm,
    preset.platePaddingXEm,
    preset.activePaddingXEm,
    preset.activeScale,
    preset.entranceScaleFrom,
    preset.groupScaleTo,
    `${width}x${height}`,
    textSignature,
  ].join(":");
  const cached = cachedForWords.get(key);
  if (cached) return cached;
  const layout = buildCaptionLayout(ctx, words, width, height, preset);
  cachedForWords.set(key, layout);
  return layout;
}

function roundedRect(
  ctx: CaptionContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.max(0, radius));
}

function groupEntranceAlpha(
  preset: CaptionPresetDefinition,
  group: CaptionGroup,
  timestamp: number,
): number {
  if (preset.entrance !== "page-fade" && preset.entrance !== "group-fade")
    return 1;
  return easeOutCubic(
    captionEntranceProgress(timestamp, group.start, preset.entranceDurationSec),
  );
}

function wordMotion(
  preset: CaptionPresetDefinition,
  word: WordCue,
  timestamp: number,
): WordMotion {
  if (
    preset.entrance !== "word-blur" &&
    preset.entrance !== "word-scale" &&
    preset.entrance !== "word-rise"
  ) {
    return { opacity: 1, scale: 1, blurEm: 0, translateYEm: 0 };
  }
  const rawProgress = captionEntranceProgress(
    timestamp,
    word.start,
    preset.entranceDurationSec,
  );
  const progress = easeOutCubic(rawProgress);
  return {
    opacity: progress,
    scale: preset.entranceScaleFrom + (1 - preset.entranceScaleFrom) * progress,
    blurEm: preset.entranceBlurEm * (1 - progress),
    translateYEm: preset.entrance === "word-rise" ? 0.32 * (1 - progress) : 0,
  };
}

function activeOverlayAlpha(
  preset: CaptionPresetDefinition,
  word: WordCue,
  active: boolean,
  timestamp: number,
): number {
  const duration = preset.activeTransitionSec;
  if (duration <= 0) return active ? 1 : 0;
  if (active) {
    return easeOutCubic(
      captionEntranceProgress(timestamp, word.start, duration),
    );
  }
  if (timestamp >= word.end && timestamp < word.end + duration) {
    return (
      1 - easeOutCubic(captionEntranceProgress(timestamp, word.end, duration))
    );
  }
  return 0;
}

function drawCaptionPlate(
  ctx: CaptionContext,
  layout: CaptionLayout,
  canvasWidth: number,
  preset: CaptionPresetDefinition,
): void {
  if (preset.plateStyle === "none") return;
  const padX = layout.fontPx * preset.platePaddingXEm;
  const padY = layout.fontPx * preset.platePaddingYEm;
  const radius = layout.fontPx * preset.plateRadiusEm;
  const plateWidth = layout.maxLineWidth + padX * 2;
  const plateHeight = layout.bottom - layout.top + padY * 2;

  ctx.save();
  ctx.globalAlpha *= preset.plateOpacity;
  ctx.fillStyle = preset.plateColor;
  roundedRect(
    ctx,
    canvasWidth / 2 - plateWidth / 2,
    layout.top - padY,
    plateWidth,
    plateHeight,
    radius,
  );
  ctx.fill();
  ctx.restore();
}

function drawActiveGradientPill(
  ctx: CaptionContext,
  placement: CaptionWordPlacement,
  baseline: number,
  fontPx: number,
  preset: CaptionPresetDefinition,
  alpha: number,
): void {
  if (!preset.activeGradient || alpha <= 0) return;
  const padX = fontPx * preset.activePaddingXEm;
  const padY = fontPx * preset.activePaddingYEm;
  const x = placement.x - padX;
  const y = baseline - fontPx * 0.91 - padY;
  const width = placement.width + padX * 2;
  const height = fontPx * 1.08 + padY * 2;
  const gradient = ctx.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, preset.activeGradient.from);
  gradient.addColorStop(1, preset.activeGradient.to);

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = gradient;
  roundedRect(ctx, x, y, width, height, fontPx * preset.activeRadiusEm);
  ctx.fill();
  ctx.restore();
}

function applyTextShadow(
  ctx: CaptionContext,
  preset: CaptionPresetDefinition,
  fontPx: number,
  glowColor?: string,
): void {
  ctx.shadowColor = glowColor ?? preset.shadowColor;
  ctx.shadowBlur = glowColor ? fontPx * 0.28 : fontPx * preset.shadowBlurEm;
  ctx.shadowOffsetX = glowColor ? 0 : fontPx * preset.shadowOffsetXEm;
  ctx.shadowOffsetY = glowColor ? 0 : fontPx * preset.shadowOffsetYEm;
}

function clearTextShadow(ctx: CaptionContext): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function paintText(
  ctx: CaptionContext,
  text: string,
  x: number,
  baseline: number,
  color: string,
  preset: CaptionPresetDefinition,
  fontPx: number,
  options: {
    alpha?: number;
    scale?: number;
    rotationDeg?: number;
    blurEm?: number;
    glowColor?: string;
    includeOutline?: boolean;
    includeShadow?: boolean;
    outlineWidthEm?: number;
    translateYEm?: number;
    fillCompositeOperation?: GlobalCompositeOperation;
  } = {},
): void {
  const {
    alpha = 1,
    scale = 1,
    rotationDeg = 0,
    blurEm = 0,
    glowColor,
    includeOutline = true,
    includeShadow = true,
    outlineWidthEm = preset.outlineWidthEm,
    translateYEm = 0,
    fillCompositeOperation,
  } = options;
  if (alpha <= 0) return;

  const measuredWidth = ctx.measureText(text).width;
  const centerX = x + measuredWidth / 2;
  const centerY = baseline - fontPx * 0.42;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (blurEm > 0) {
    const typographyCtx = ctx as CaptionContextWithTypography;
    if ("filter" in typographyCtx)
      typographyCtx.filter = `blur(${fontPx * blurEm}px)`;
  }
  ctx.translate(0, fontPx * translateYEm);
  ctx.translate(centerX, centerY);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-centerX, -centerY);

  if (includeShadow) applyTextShadow(ctx, preset, fontPx, glowColor);
  if (includeOutline && outlineWidthEm > 0) {
    ctx.lineWidth = Math.max(1, fontPx * outlineWidthEm * 2);
    ctx.strokeStyle = preset.outlineColor;
    ctx.strokeText(text, x, baseline);
    clearTextShadow(ctx);
  }
  if (fillCompositeOperation) {
    ctx.globalCompositeOperation = fillCompositeOperation;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, baseline);
  ctx.restore();
}

function drawKaraokeWord(
  ctx: CaptionContext,
  placement: CaptionWordPlacement,
  baseline: number,
  fontPx: number,
  preset: CaptionPresetDefinition,
  word: WordCue,
  timestamp: number,
): void {
  paintText(
    ctx,
    placement.text,
    placement.x,
    baseline,
    preset.textColor,
    preset,
    fontPx,
  );
  const progress = captionProgress(timestamp, word.start, word.end);
  if (progress <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    placement.x - fontPx * 0.05,
    baseline - fontPx,
    placement.width * progress + fontPx * 0.1,
    fontPx * 1.35,
  );
  ctx.clip();
  paintText(
    ctx,
    placement.text,
    placement.x,
    baseline,
    preset.activeTextColor,
    preset,
    fontPx,
    { includeShadow: false },
  );
  ctx.restore();
}

function drawPhraseWord(
  ctx: CaptionContext,
  placement: CaptionWordPlacement,
  baseline: number,
  layout: CaptionLayout,
  preset: CaptionPresetDefinition,
  word: WordCue,
  active: boolean,
  timestamp: number,
): void {
  const motion = wordMotion(preset, word, timestamp);
  if (motion.opacity <= 0) return;

  if (preset.activeEffect === "beast-pop") {
    const progress = active
      ? easeOutBack(
          captionEntranceProgress(
            timestamp,
            word.start,
            preset.activeTransitionSec,
          ),
        )
      : 0;
    paintText(
      ctx,
      placement.text,
      placement.x,
      baseline,
      active ? preset.activeTextColor : preset.textColor,
      preset,
      layout.fontPx,
      {
        alpha: motion.opacity,
        scale: motion.scale * (1 + (preset.activeScale - 1) * progress),
        rotationDeg: preset.activeRotationDeg * progress,
        blurEm: motion.blurEm,
        translateYEm: motion.translateYEm,
      },
    );
    return;
  }

  if (preset.activeEffect === "pop") {
    const progress = active
      ? easeOutBack(
          captionEntranceProgress(
            timestamp,
            word.start,
            preset.activeTransitionSec,
          ),
        )
      : 0;
    paintText(
      ctx,
      placement.text,
      placement.x,
      baseline,
      active ? preset.activeTextColor : preset.textColor,
      preset,
      layout.fontPx,
      {
        alpha: motion.opacity * (active ? 1 : (preset.inactiveOpacity ?? 1)),
        scale: motion.scale * (1 + (preset.activeScale - 1) * progress),
        blurEm: motion.blurEm,
        translateYEm: motion.translateYEm,
      },
    );
    return;
  }

  if (preset.activeEffect === "hustle") {
    paintText(
      ctx,
      placement.text,
      placement.x,
      baseline,
      active ? preset.activeTextColor : preset.textColor,
      preset,
      layout.fontPx,
      {
        alpha: motion.opacity,
        scale: motion.scale,
        blurEm: motion.blurEm,
        translateYEm: motion.translateYEm,
        outlineWidthEm: active
          ? (preset.activeOutlineWidthEm ?? preset.outlineWidthEm)
          : preset.outlineWidthEm,
      },
    );
    return;
  }

  if (preset.activeEffect === "glow") {
    paintText(
      ctx,
      placement.text,
      placement.x,
      baseline,
      active ? preset.activeTextColor : preset.textColor,
      preset,
      layout.fontPx,
      {
        alpha: motion.opacity,
        scale: motion.scale,
        blurEm: motion.blurEm,
        glowColor: active ? preset.activeColor : undefined,
        translateYEm: motion.translateYEm,
      },
    );
    return;
  }

  paintText(
    ctx,
    placement.text,
    placement.x,
    baseline,
    preset.textColor,
    preset,
    layout.fontPx,
    {
      alpha: motion.opacity,
      scale: motion.scale,
      blurEm: motion.blurEm,
      translateYEm: motion.translateYEm,
    },
  );

  if (
    preset.activeEffect === "color" ||
    preset.activeEffect === "gradient-pill" ||
    preset.activeEffect === "longest-color"
  ) {
    const overlayAlpha = activeOverlayAlpha(preset, word, active, timestamp);
    paintText(
      ctx,
      placement.text,
      placement.x,
      baseline,
      preset.activeTextColor,
      preset,
      layout.fontPx,
      {
        alpha: motion.opacity * overlayAlpha,
        scale: motion.scale,
        blurEm: motion.blurEm,
        translateYEm: motion.translateYEm,
        includeOutline: false,
        includeShadow: false,
      },
    );
  }
}

function drawKineticCaption(
  ctx: CaptionContext,
  group: CaptionGroup,
  activeWordIndex: number,
  timestamp: number,
  width: number,
  height: number,
  preset: CaptionPresetDefinition,
): void {
  const mainWordIndex = group.words.reduce((bestIndex, word, index, words) => {
    const length = word.text.replace(/[^\p{L}\p{N}]/gu, "").length;
    const bestLength = words[bestIndex]!.text.replace(
      /[^\p{L}\p{N}]/gu,
      "",
    ).length;
    return length > bestLength ? index : bestIndex;
  }, 0);
  let mainFontPx = Math.max(12, Math.round(height * preset.fontSizeRatio));
  const centerX = width / 2;
  const centerY = height * preset.anchorY;

  ctx.save();
  try {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";

    const mainText = preset.uppercase
      ? group.words[mainWordIndex]!.text.toLocaleUpperCase()
      : group.words[mainWordIndex]!.text;
    const sideIndices = group.words
      .map((_, index) => index)
      .filter((index) => index !== mainWordIndex);
    const sideAnchors = [
      { dx: -0.38, dy: -0.62 },
      { dx: 0.42, dy: -0.48 },
      { dx: 0, dy: 0.78 },
    ] as const;
    const measureKineticLayout = (candidateMainFontPx: number) => {
      applyCustomFont(
        ctx,
        preset.fontFamily,
        preset.fontWeight,
        preset.fontStyle,
        candidateMainFontPx,
        preset.letterSpacingEm,
      );
      const mainWidth = ctx.measureText(mainText).width;
      const sideFontPx =
        candidateMainFontPx * (preset.secondaryFontSizeScale ?? 0.52);
      let minimumX = -mainWidth / 2;
      let maximumX = mainWidth / 2;

      sideIndices.forEach((wordIndex, sideOrder) => {
        applyCustomFont(
          ctx,
          preset.secondaryFontFamily ?? preset.fontFamily,
          700,
          "normal",
          sideFontPx,
        );
        const word = group.words[wordIndex]!;
        const text = preset.uppercase
          ? word.text.toLocaleUpperCase()
          : word.text;
        const textWidth = ctx.measureText(text).width;
        const anchor = sideAnchors[sideOrder % sideAnchors.length]!;
        const centerOffset = anchor.dx * mainWidth;
        minimumX = Math.min(minimumX, centerOffset - textWidth / 2);
        maximumX = Math.max(maximumX, centerOffset + textWidth / 2);
      });

      const horizontalPadding =
        candidateMainFontPx * captionHorizontalPaddingEm(preset);
      return {
        mainWidth,
        sideFontPx,
        paintedWidth:
          (maximumX - minimumX) * captionWordScale(preset) +
          horizontalPadding * 2,
      };
    };

    let kineticLayout = measureKineticLayout(mainFontPx);
    const availableWidth = width * preset.maxWidthRatio;
    if (kineticLayout.paintedWidth > availableWidth) {
      mainFontPx = Math.max(
        1,
        Math.floor((mainFontPx * availableWidth) / kineticLayout.paintedWidth),
      );
      kineticLayout = measureKineticLayout(mainFontPx);
    }
    const { mainWidth, sideFontPx } = kineticLayout;

    for (let index = 0; index < group.words.length; index++) {
      const word = group.words[index]!;
      if (timestamp < word.start) continue;
      const isMain = index === mainWordIndex;
      const fontPx = isMain ? mainFontPx : sideFontPx;
      const family = isMain
        ? preset.fontFamily
        : (preset.secondaryFontFamily ?? preset.fontFamily);
      const weight = isMain ? preset.fontWeight : 700;
      applyCustomFont(
        ctx,
        family,
        weight,
        "normal",
        fontPx,
        isMain ? preset.letterSpacingEm : 0,
      );
      const text = preset.uppercase ? word.text.toLocaleUpperCase() : word.text;
      const textWidth = ctx.measureText(text).width;
      let x = centerX - textWidth / 2;
      let baseline = centerY + mainFontPx * 0.25;
      if (!isMain) {
        const sideOrder = sideIndices.indexOf(index);
        const anchor = sideAnchors[sideOrder % sideAnchors.length]!;
        x = centerX + anchor.dx * mainWidth - textWidth / 2;
        baseline = centerY + anchor.dy * mainFontPx;
      }

      const progress = easeOutCubic(
        captionEntranceProgress(
          timestamp,
          word.start,
          preset.entranceDurationSec,
        ),
      );
      paintText(
        ctx,
        text,
        x,
        baseline,
        index === activeWordIndex ? preset.activeTextColor : preset.textColor,
        preset,
        fontPx,
        {
          alpha: progress,
          scale:
            preset.entranceScaleFrom +
            (1 - preset.entranceScaleFrom) * progress,
          translateYEm: 0.28 * (1 - progress),
          fillCompositeOperation: preset.differenceBlend
            ? "difference"
            : undefined,
        },
      );
    }
  } finally {
    ctx.restore();
  }
}

function drawPodcastCaption(
  ctx: CaptionContext,
  group: CaptionGroup,
  timestamp: number,
  width: number,
  height: number,
  preset: CaptionPresetDefinition,
): void {
  let fontPx = Math.max(12, Math.round(height * preset.fontSizeRatio));
  const splitAt = Math.ceil(group.words.length / 2);
  const lines = [group.words.slice(0, splitAt), group.words.slice(splitAt)];
  const lineTexts = lines.map((lineWords) =>
    lineWords.map((word) =>
      preset.uppercase ? word.text.toLocaleUpperCase() : word.text,
    ),
  );
  const accents = preset.accentColors ?? [preset.activeColor];
  const accentIndex =
    Math.abs(
      Math.round(group.start * 1000) +
        (group.words[0]?.text.codePointAt(0) ?? 0),
    ) % accents.length;
  const accent = accents[accentIndex]!;

  ctx.save();
  try {
    applyFont(ctx, preset, fontPx);
    const measureMaximumLineWidth = (candidateFontPx: number) => {
      applyFont(ctx, preset, candidateFontPx);
      const candidateWordGap = candidateFontPx * preset.wordGapEm;
      return Math.max(
        ...lineTexts.map((texts) => {
          const textWidth = texts.reduce(
            (sum, text) => sum + ctx.measureText(text).width,
            0,
          );
          return textWidth + Math.max(0, texts.length - 1) * candidateWordGap;
        }),
        0,
      );
    };
    const baseLineWidth = measureMaximumLineWidth(fontPx);
    const paintedLineWidth =
      baseLineWidth * captionWordScale(preset) +
      fontPx * captionHorizontalPaddingEm(preset) * 2;
    const availableWidth = width * preset.maxWidthRatio;
    if (paintedLineWidth > availableWidth) {
      fontPx = Math.max(
        1,
        Math.floor((fontPx * availableWidth) / paintedLineWidth),
      );
      applyFont(ctx, preset, fontPx);
    }
    const wordGap = fontPx * preset.wordGapEm;
    const lineHeight = fontPx * preset.lineHeightRatio;
    const firstBaseline = height * preset.anchorY - lineHeight * 0.18;

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";

    lines.forEach((lineWords, lineIndex) => {
      if (lineWords.length === 0) return;
      const texts = lineTexts[lineIndex]!;
      const widths = texts.map((text) => ctx.measureText(text).width);
      const lineWidth =
        widths.reduce((sum, wordWidth) => sum + wordWidth, 0) +
        Math.max(0, widths.length - 1) * wordGap;
      const floatY =
        Math.sin(timestamp * Math.PI * 1.5 + lineIndex * 1.5) * fontPx * 0.02;
      let x = width / 2 - lineWidth / 2;
      const baseline = firstBaseline + lineIndex * lineHeight + floatY;

      lineWords.forEach((word, wordIndex) => {
        const progress = easeOutBack(
          captionEntranceProgress(
            timestamp,
            word.start,
            preset.entranceDurationSec,
          ),
        );
        if (timestamp < word.start) {
          x += widths[wordIndex]! + wordGap;
          return;
        }
        paintText(
          ctx,
          texts[wordIndex]!,
          x,
          baseline,
          lineIndex === 0 ? preset.textColor : accent,
          preset,
          fontPx,
          {
            alpha: clampCaptionProgress(progress),
            scale:
              preset.entranceScaleFrom +
              (1 - preset.entranceScaleFrom) * progress,
          },
        );
        x += widths[wordIndex]! + wordGap;
      });
    });
  } finally {
    ctx.restore();
  }
}

function drawCaptionWordBlock(
  ctx: CaptionContext,
  group: CaptionGroup,
  activeWordIndex: number,
  timestamp: number,
  width: number,
  height: number,
  preset: CaptionPresetDefinition,
): void {
  if (group.words.length === 0) return;
  if (preset.renderer === "kinetic") {
    drawKineticCaption(
      ctx,
      group,
      activeWordIndex,
      timestamp,
      width,
      height,
      preset,
    );
    return;
  }
  if (preset.renderer === "podcast") {
    drawPodcastCaption(ctx, group, timestamp, width, height, preset);
    return;
  }
  ctx.save();
  try {
    const layout = getCaptionLayout(ctx, group.words, width, height, preset);
    applyFont(ctx, preset, layout.fontPx);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    const entranceAlpha = groupEntranceAlpha(preset, group, timestamp);
    ctx.globalAlpha *= entranceAlpha;
    if (preset.groupScaleTo && preset.groupScaleTo !== 1) {
      const progress = captionProgress(timestamp, group.start, group.end);
      const scale = 1 + (preset.groupScaleTo - 1) * progress;
      ctx.translate(width / 2, height * preset.anchorY);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height * preset.anchorY);
    }
    drawCaptionPlate(ctx, layout, width, preset);

    const emphasizedWordIndex =
      preset.activeEffect === "longest-color"
        ? group.words.reduce((bestIndex, word, index, words) => {
            const length = word.text.replace(/[^\p{L}\p{N}]/gu, "").length;
            const bestLength = words[bestIndex]!.text.replace(
              /[^\p{L}\p{N}]/gu,
              "",
            ).length;
            return length > bestLength ? index : bestIndex;
          }, 0)
        : -1;

    if (preset.activeEffect === "gradient-pill") {
      for (const line of layout.lines) {
        for (const placement of line.words) {
          const word = group.words[placement.index]!;
          const active =
            placement.index === activeWordIndex && activeWordIndex >= 0;
          drawActiveGradientPill(
            ctx,
            placement,
            line.baseline,
            layout.fontPx,
            preset,
            activeOverlayAlpha(preset, word, active, timestamp),
          );
        }
      }
    }

    const isEmphasizedWord = (index: number): boolean =>
      preset.activeEffect === "longest-color"
        ? index === emphasizedWordIndex
        : index === activeWordIndex && activeWordIndex >= 0;

    const drawWordAtPlacement = (
      placement: CaptionWordPlacement,
      baseline: number,
    ): void => {
      const word = group.words[placement.index]!;
      if (preset.renderer === "karaoke") {
        drawKaraokeWord(
          ctx,
          placement,
          baseline,
          layout.fontPx,
          preset,
          word,
          timestamp,
        );
        return;
      }
      drawPhraseWord(
        ctx,
        placement,
        baseline,
        layout,
        preset,
        word,
        isEmphasizedWord(placement.index),
        timestamp,
      );
    };

    const drawWordsPass = (emphasizedOnly: boolean): void => {
      for (const line of layout.lines) {
        for (const placement of line.words) {
          const emphasized = isEmphasizedWord(placement.index);
          if (emphasizedOnly ? !emphasized : emphasized) continue;
          drawWordAtPlacement(placement, line.baseline);
        }
      }
    };

    if (preset.renderer === "karaoke") {
      for (const line of layout.lines) {
        for (const placement of line.words) {
          drawWordAtPlacement(placement, line.baseline);
        }
      }
    } else {
      drawWordsPass(false);
      drawWordsPass(true);
    }
  } finally {
    ctx.restore();
  }
}

export function drawPhraseAnimatedCaption(
  ctx: CaptionContext,
  groups: CaptionGroup[],
  timestamp: number,
  width: number,
  height: number,
  presetId: ClipperCaptionPresetId,
  presetOverride?: CaptionPresetDefinition,
): void {
  const active = findActiveCaptionGroup(groups, timestamp);
  if (!active) return;
  const preset = presetOverride ?? resolveCaptionPreset(presetId);
  if (preset.renderer === "one-word" && active.activeWordIndex < 0) return;
  drawCaptionWordBlock(
    ctx,
    active.group,
    active.activeWordIndex,
    timestamp,
    width,
    height,
    preset,
  );
}

export function drawAnimatedCaption(
  ctx: CaptionContext,
  words: WordCue[],
  timestamp: number,
  width: number,
  height: number,
  presetId: ClipperCaptionPresetId,
): void {
  const preset = resolveCaptionPreset(presetId);
  const activeIndex = findActiveCaptionWordIndex(words, timestamp);
  if (activeIndex === -1) return;
  const windowStart = Math.max(
    0,
    activeIndex - Math.floor(preset.wordsPerGroup / 2),
  );
  const windowEnd = Math.min(words.length, windowStart + preset.wordsPerGroup);
  const visibleWords = words.slice(windowStart, windowEnd);
  if (visibleWords.length === 0) return;
  drawCaptionWordBlock(
    ctx,
    {
      words: visibleWords,
      start: visibleWords[0]!.start,
      end: visibleWords[visibleWords.length - 1]!.end,
    },
    activeIndex - windowStart,
    timestamp,
    width,
    height,
    preset,
  );
}
