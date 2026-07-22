import { VideoSampleSink, QUALITY_HIGH, type InputVideoTrack } from "mediabunny";
import type { Input } from "mediabunny";

export const AAC_BITRATE = 192_000;

export interface FrameEffectSize {
  width: number;
  height: number;
}

const ENCODE_BITRATE_MAX_RATIO = 16;

/** Mediabunny `QUALITY_HIGH` (factor 2) bitrate for AVC at the given dimensions. */
export function highQualityVideoBitrate(width: number, height: number): number {
  const pixels = width * height;
  const referencePixels = 1920 * 1080;
  const referenceBitrate = 3_000_000;
  const scaleFactor = (pixels / referencePixels) ** 0.95;
  const finalBitrate = referenceBitrate * scaleFactor * 2;
  return Math.ceil(finalBitrate / 1000) * 1000;
}

/** Boost encode bitrate when output has more pixels than source (e.g. upscale re-encode). */
export function encodeBitrateForSizedOutput(
  source: FrameEffectSize,
  output: FrameEffectSize,
): number | typeof QUALITY_HIGH {
  const sourcePixels = source.width * source.height;
  const outputPixels = output.width * output.height;
  if (sourcePixels <= 0 || outputPixels <= sourcePixels) return QUALITY_HIGH;
  const ratio = Math.min(ENCODE_BITRATE_MAX_RATIO, outputPixels / sourcePixels);
  const sourceBaseline = highQualityVideoBitrate(source.width, source.height);
  return Math.round((sourceBaseline * ratio) / 1000) * 1000;
}

/** Draws the processed frame into `ctx`. `ctx.canvas` is already sized per `size`. */
export type FrameEffect = (
  ctx: OffscreenCanvasRenderingContext2D,
  frame: VideoFrame,
  size: FrameEffectSize,
) => void;

/** Like `FrameEffect`, but receives both source and output canvas dimensions. */
export type SizedFrameEffect = (
  ctx: OffscreenCanvasRenderingContext2D,
  frame: VideoFrame,
  source: FrameEffectSize,
  output: FrameEffectSize,
) => void;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
}

/**
 * Prefers decoded frame dimensions over track metadata so upscale output size
 * matches actual pixel data (avoids Lanczos no-op when metadata is understated).
 */
export async function resolveVideoSourceSize(
  videoTrack: InputVideoTrack,
): Promise<FrameEffectSize> {
  const trackSize: FrameEffectSize = {
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
  };
  try {
    const sink = new VideoSampleSink(videoTrack);
    const sample = await sink.getSample(0);
    if (!sample) return trackSize;
    try {
      const frame = sample.toVideoFrame();
      try {
        const { displayWidth: width, displayHeight: height } = frame;
        if (width > 0 && height > 0) return { width, height };
      } finally {
        frame.close();
      }
    } finally {
      sample.close();
    }
  } catch {
    // Fall back to container metadata when the first frame cannot be read.
  }
  return trackSize;
}

export type AudioTrackMode = "copy" | "transcode" | null;

/** The track type yielded by `Input.getAudioTracks()`, exposed for reuse outside this module. */
export type InputAudioTrack = Awaited<ReturnType<Input["getAudioTracks"]>>[number];
