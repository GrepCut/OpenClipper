/**
 * Shared "bake a per-frame Canvas 2D effect into a video" pipeline. Decodes
 * every video frame via Mediabunny (WebCodecs), lets the caller draw into an
 * OffscreenCanvas, and re-encodes the result. Audio is copied (AAC) or
 * transcoded to AAC unchanged. Modeled on `rotate-video/process/bake-rotate.ts`.
 */
import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type InputVideoTrack,
} from "mediabunny";
import { createFileSystemWriteProxy } from '../convert/file-system-write-proxy.util';
import type { ConvertOptions, ConversionOutput } from '../types/converter.types';
import {
  downscaleExtractedFrame,
  extractRawVideoFrame,
  type ExtractedVideoFrame,
  type FramePosition,
} from "./video-frame-extract.util";
import { EncodeBackpressure } from "./encode-backpressure.util";

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

export type AudioTrackMode = "copy" | "transcode" | null;

/** The track type yielded by `Input.getAudioTracks()`, exposed for reuse outside this module. */
export type InputAudioTrack = Awaited<ReturnType<Input["getAudioTracks"]>>[number];

export async function processAudioTrack(
  audioTrack: InputAudioTrack | null,
  audioSource: EncodedAudioPacketSource | AudioSampleSource | null,
  audioMode: AudioTrackMode,
  signal?: AbortSignal,
): Promise<void> {
  if (!audioTrack || !audioSource) return;

  if (audioMode === "copy") {
    const src = audioSource as EncodedAudioPacketSource;
    const packetSink = new EncodedPacketSink(audioTrack);
    const decoderConfig = (await audioTrack.getDecoderConfig()) ?? undefined;
    let first = true;
    let timeOffset = 0;
    for await (const packet of packetSink.packets()) {
      throwIfAborted(signal);
      if (first && packet.timestamp < 0) {
        timeOffset = -packet.timestamp;
      }
      const processed =
        timeOffset > 0 ? packet.clone({ timestamp: packet.timestamp + timeOffset }) : packet;
      await src.add(processed, first && decoderConfig ? { decoderConfig } : undefined);
      first = false;
    }
  } else {
    const src = audioSource as AudioSampleSource;
    const sampleSink = new AudioSampleSink(audioTrack);
    let timeOffset = 0;
    let sampleCount = 0;
    for await (const audioSample of sampleSink.samples()) {
      sampleCount++;
      throwIfAborted(signal);
      if (sampleCount === 1 && audioSample.timestamp < 0) {
        timeOffset = -audioSample.timestamp;
      }
      if (timeOffset > 0) {
        audioSample.setTimestamp(audioSample.timestamp + timeOffset);
      }
      await src.add(audioSample);
      audioSample.close();
    }
  }
  audioSource.close();
}

/** Builds the right audio source/mode pair for a track: AAC packets are copied, anything else is transcoded to AAC. */
export function createAudioSource(
  audioTrack: InputAudioTrack | null,
): { audioSource: EncodedAudioPacketSource | AudioSampleSource | null; audioMode: AudioTrackMode } {
  const audioMode: AudioTrackMode = audioTrack ? (audioTrack.codec === "aac" ? "copy" : "transcode") : null;
  const audioSource =
    audioMode === "copy"
      ? new EncodedAudioPacketSource("aac")
      : audioMode === "transcode"
        ? new AudioSampleSource({ codec: "aac", bitrate: AAC_BITRATE })
        : null;
  return { audioSource, audioMode };
}

/**
 * Decodes the video track frame-by-frame, calls `applyEffect` on each frame via
 * an OffscreenCanvas, re-encodes the result, and copies/transcodes any audio
 * track unchanged. Output keeps the source frame dimensions.
 */
export async function bakeVideoFrameEffect(
  file: File,
  applyEffect: FrameEffect,
  options: ConvertOptions = {},
): Promise<ConversionOutput> {
  const { signal, onProgress, outputFileHandle } = options;
  throwIfAborted(signal);

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  const toFile = Boolean(outputFileHandle);
  const writable = outputFileHandle ? await outputFileHandle.createWritable() : null;
  const target = writable
    ? new StreamTarget(createFileSystemWriteProxy(writable), { chunked: true })
    : new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: toFile ? false : "in-memory" });

  let completed = false;
  try {
    onProgress?.({ ratio: null, stage: "reading" });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No video track found in the input file.");
    }
    const audioTrack = (await input.getAudioTracks())[0] ?? null;
    const totalDuration = await input.computeDuration();

    const output = new Output({ format, target });

    const videoSource = new VideoSampleSource({
      codec: "avc",
      bitrate: QUALITY_HIGH,
      latencyMode: "realtime",
    });
    output.addVideoTrack(videoSource);

    const { audioSource, audioMode } = createAudioSource(audioTrack);
    if (audioSource) {
      output.addAudioTrack(audioSource);
    }

    const onAbort = () => {
      void output.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const processVideo = async (): Promise<void> => {
      const sink = new VideoSampleSink(videoTrack);
      const canvasCache = new FrameCanvasCache();
      let frameCount = 0;
      let timeOffset = 0;

      for await (const sample of sink.samples()) {
        frameCount++;
        throwIfAborted(signal);

        if (frameCount === 1 && sample.timestamp < 0) {
          timeOffset = -sample.timestamp;
        }
        if (timeOffset > 0) {
          sample.setTimestamp(sample.timestamp + timeOffset);
        }

        const frame = sample.toVideoFrame();
        try {
          const processed = renderEffectFrame(frame, applyEffect, canvasCache);
          try {
            const outSample = new VideoSample(processed, {
              timestamp: sample.timestamp,
              duration: sample.duration,
            });
            try {
              await videoSource.add(outSample);
            } finally {
              outSample.close();
            }
          } finally {
            processed.close();
          }
        } finally {
          frame.close();
          sample.close();
        }

        if (totalDuration > 0) {
          onProgress?.({
            ratio: Math.min(0.99, sample.timestamp / totalDuration),
            stage: "processing",
          });
        }
      }
      videoSource.close();
    };

    try {
      await output.start();
      const results = await Promise.allSettled([
        processVideo(),
        processAudioTrack(audioTrack, audioSource, audioMode, signal),
      ]);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;

      throwIfAborted(signal);
      onProgress?.({ ratio: 1, stage: "finalizing" });
      await output.finalize();
      completed = true;
    } catch (err) {
      if (output.state !== "finalized" && output.state !== "canceled") {
        await output.cancel().catch(() => {});
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (toFile) {
      await writable!.close();
      return { kind: "file", size: (await outputFileHandle!.getFile()).size };
    }
    const buffer = (target as BufferTarget).buffer;
    if (!buffer) throw new Error("Conversion produced no output.");
    return { kind: "memory", blob: new Blob([buffer], { type: "video/mp4" }) };
  } finally {
    input.dispose();
    if (writable && !completed) await writable.abort().catch(() => {});
  }
}

/**
 * Like `bakeVideoFrameEffect`, but each frame is rendered onto a canvas whose
 * dimensions are resolved once from the source track via `resolveOutputSize`.
 */
export async function bakeVideoSizedFrameEffect(
  file: File,
  resolveOutputSize: (source: FrameEffectSize) => FrameEffectSize,
  applyEffect: SizedFrameEffect,
  options: ConvertOptions = {},
): Promise<ConversionOutput> {
  const { signal, onProgress, outputFileHandle } = options;
  throwIfAborted(signal);

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  const toFile = Boolean(outputFileHandle);
  const writable = outputFileHandle ? await outputFileHandle.createWritable() : null;
  const target = writable
    ? new StreamTarget(createFileSystemWriteProxy(writable), { chunked: true })
    : new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: toFile ? false : "in-memory" });

  let completed = false;
  try {
    onProgress?.({ ratio: null, stage: "reading" });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No video track found in the input file.");
    }
    const audioTrack = (await input.getAudioTracks())[0] ?? null;
    const totalDuration = await input.computeDuration();

    const sourceSize = await resolveVideoSourceSize(videoTrack);
    const outputSize = resolveOutputSize(sourceSize);

    const output = new Output({ format, target });

    const videoSource = new VideoSampleSource({
      codec: "avc",
      bitrate: encodeBitrateForSizedOutput(sourceSize, outputSize),
      latencyMode: "realtime",
    });
    output.addVideoTrack(videoSource);

    const { audioSource, audioMode } = createAudioSource(audioTrack);
    if (audioSource) {
      output.addAudioTrack(audioSource);
    }

    const onAbort = () => {
      void output.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const processVideo = async (): Promise<void> => {
      const sink = new VideoSampleSink(videoTrack);
      const canvasCache = new FrameCanvasCache();
      const encodeBackpressure = new EncodeBackpressure();
      let frameCount = 0;
      let timeOffset = 0;

      for await (const sample of sink.samples()) {
        frameCount++;
        throwIfAborted(signal);

        if (frameCount === 1 && sample.timestamp < 0) {
          timeOffset = -sample.timestamp;
        }
        if (timeOffset > 0) {
          sample.setTimestamp(sample.timestamp + timeOffset);
        }

        const frame = sample.toVideoFrame();
        try {
          const processed = renderSizedEffectFrame(frame, outputSize, applyEffect, canvasCache);
          try {
            const outSample = new VideoSample(processed, {
              timestamp: sample.timestamp,
              duration: sample.duration,
            });
            try {
              await encodeBackpressure.run(() => videoSource.add(outSample));
            } finally {
              outSample.close();
            }
          } finally {
            processed.close();
          }
        } finally {
          frame.close();
          sample.close();
        }

        if (totalDuration > 0) {
          onProgress?.({
            ratio: Math.min(0.99, sample.timestamp / totalDuration),
            stage: "processing",
          });
        }
      }
      videoSource.close();
    };

    try {
      await output.start();
      const results = await Promise.allSettled([
        processVideo(),
        processAudioTrack(audioTrack, audioSource, audioMode, signal),
      ]);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;

      throwIfAborted(signal);
      onProgress?.({ ratio: 1, stage: "finalizing" });
      await output.finalize();
      completed = true;
    } catch (err) {
      if (output.state !== "finalized" && output.state !== "canceled") {
        await output.cancel().catch(() => {});
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (toFile) {
      await writable!.close();
      return { kind: "file", size: (await outputFileHandle!.getFile()).size };
    }
    const buffer = (target as BufferTarget).buffer;
    if (!buffer) throw new Error("Conversion produced no output.");
    return { kind: "memory", blob: new Blob([buffer], { type: "video/mp4" }) };
  } finally {
    input.dispose();
    if (writable && !completed) await writable.abort().catch(() => {});
  }
}
