import {
  downscaleExtractedFrame,
  extractRawVideoFrame,
  type ExtractedVideoFrame,
  type FramePosition,
} from "./video-frame-extract.util";
import type { FrameEffect, FrameEffectSize, SizedFrameEffect } from "./video-frame-effect.types";

/**
 * Caches a single OffscreenCanvas/2D context for reuse across frames, only
 * reallocating when the requested size changes (rare mid-stream). Avoids a
 * fresh canvas + context allocation on every decoded frame.
 */
export class FrameCanvasCache {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private width = -1;
  private height = -1;

  get(width: number, height: number): OffscreenCanvasRenderingContext2D {
    if (!this.ctx || width !== this.width || height !== this.height) {
      this.canvas = new OffscreenCanvas(width, height);
      const ctx = this.canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create 2D canvas for frame effect.");
      this.ctx = ctx;
      this.width = width;
      this.height = height;
    }
    return this.ctx;
  }
}

/** Resets a context's paint state and clears it so effects can't see the previous frame. */
export function resetContext(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, width, height);
}

export function renderEffectFrame(
  frame: VideoFrame,
  applyEffect: FrameEffect,
  cache: FrameCanvasCache,
): VideoFrame {
  const width = frame.displayWidth;
  const height = frame.displayHeight;

  const ctx = cache.get(width, height);
  ctx.save();
  resetContext(ctx, width, height);
  try {
    applyEffect(ctx, frame, { width, height });
  } finally {
    ctx.restore();
  }

  return new VideoFrame(ctx.canvas, {
    timestamp: frame.timestamp,
    duration: frame.duration ?? undefined,
  });
}

/** Applies a `FrameEffect` to raw `ImageData` using the same path as video bake. */
export function applyFrameEffectToImageData(raw: ImageData, effect: FrameEffect): ImageData {
  const sourceCache = new FrameCanvasCache();
  const effectCache = new FrameCanvasCache();
  const width = raw.width;
  const height = raw.height;

  const sourceCtx = sourceCache.get(width, height);
  sourceCtx.putImageData(raw, 0, 0);

  const frame = new VideoFrame(sourceCtx.canvas, { timestamp: 0 });
  try {
    const processed = renderEffectFrame(frame, effect, effectCache);
    try {
      const outCanvas = new OffscreenCanvas(width, height);
      const outCtx = outCanvas.getContext("2d");
      if (!outCtx) throw new Error("Could not create 2D canvas for frame preview.");
      outCtx.drawImage(processed, 0, 0, width, height);
      return outCtx.getImageData(0, 0, width, height);
    } finally {
      processed.close();
    }
  } finally {
    frame.close();
  }
}

export function downscaleImageData(imageData: ImageData, maxDimension: number): ExtractedVideoFrame {
  return downscaleExtractedFrame({ imageData, width: imageData.width, height: imageData.height }, maxDimension);
}

/** Decodes one frame, applies an effect at native resolution, then downscales for display. */
export async function renderFrameEffectPreview(
  file: File,
  effect: FrameEffect,
  position: FramePosition = "middle",
  maxDimension = 960,
): Promise<ExtractedVideoFrame> {
  const raw = await extractRawVideoFrame(file, position);
  const processed = applyFrameEffectToImageData(raw.imageData, effect);
  return downscaleImageData(processed, maxDimension);
}

export function renderSizedEffectFrame(
  frame: VideoFrame,
  output: FrameEffectSize,
  applyEffect: SizedFrameEffect,
  cache: FrameCanvasCache,
): VideoFrame {
  const source = { width: frame.displayWidth, height: frame.displayHeight };

  const ctx = cache.get(output.width, output.height);
  ctx.save();
  resetContext(ctx, output.width, output.height);
  try {
    applyEffect(ctx, frame, source, output);
  } finally {
    ctx.restore();
  }

  return new VideoFrame(ctx.canvas, {
    timestamp: frame.timestamp,
    duration: frame.duration ?? undefined,
  });
}
