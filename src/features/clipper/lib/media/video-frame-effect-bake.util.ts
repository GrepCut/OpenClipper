import {
  QUALITY_HIGH,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";
import type { ConvertOptions, ConversionOutput } from "../types/converter.types";
import { EncodeBackpressure } from "./encode-backpressure.util";
import { createAudioSource, processAudioTrack } from "./video-frame-effect-audio.util";
import {
  createBakeOutputContext,
  disposeBakeOutputContext,
  finalizeBakeOutput,
} from "./video-frame-effect-output.util";
import {
  FrameCanvasCache,
  renderEffectFrame,
  renderSizedEffectFrame,
} from "./video-frame-effect-render.util";
import {
  encodeBitrateForSizedOutput,
  resolveVideoSourceSize,
  throwIfAborted,
  type FrameEffect,
  type FrameEffectSize,
  type SizedFrameEffect,
} from "./video-frame-effect.types";

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
  const ctx = await createBakeOutputContext(file, options);

  try {
    onProgress?.({ ratio: null, stage: "reading" });

    const videoSource = new VideoSampleSource({
      codec: "avc",
      bitrate: QUALITY_HIGH,
      latencyMode: "realtime",
    });
    ctx.output.addVideoTrack(videoSource);

    const { audioSource, audioMode } = createAudioSource(ctx.audioTrack);
    if (audioSource) {
      ctx.output.addAudioTrack(audioSource);
    }

    const onAbort = () => {
      void ctx.output.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const processVideo = async (): Promise<void> => {
      const sink = new VideoSampleSink(ctx.videoTrack);
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

        if (ctx.totalDuration > 0) {
          onProgress?.({
            ratio: Math.min(0.99, sample.timestamp / ctx.totalDuration),
            stage: "processing",
          });
        }
      }
      videoSource.close();
    };

    try {
      await ctx.output.start();
      const results = await Promise.allSettled([
        processVideo(),
        processAudioTrack(ctx.audioTrack, audioSource, audioMode, signal),
      ]);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;

      throwIfAborted(signal);
      onProgress?.({ ratio: 1, stage: "finalizing" });
      await ctx.output.finalize();
      ctx.completed = true;
    } catch (err) {
      if (ctx.output.state !== "finalized" && ctx.output.state !== "canceled") {
        await ctx.output.cancel().catch(() => {});
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return finalizeBakeOutput(ctx, outputFileHandle);
  } finally {
    await disposeBakeOutputContext(ctx);
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
  const ctx = await createBakeOutputContext(file, options);

  try {
    onProgress?.({ ratio: null, stage: "reading" });

    const sourceSize = await resolveVideoSourceSize(ctx.videoTrack);
    const outputSize = resolveOutputSize(sourceSize);

    const videoSource = new VideoSampleSource({
      codec: "avc",
      bitrate: encodeBitrateForSizedOutput(sourceSize, outputSize),
      latencyMode: "realtime",
    });
    ctx.output.addVideoTrack(videoSource);

    const { audioSource, audioMode } = createAudioSource(ctx.audioTrack);
    if (audioSource) {
      ctx.output.addAudioTrack(audioSource);
    }

    const onAbort = () => {
      void ctx.output.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const processVideo = async (): Promise<void> => {
      const sink = new VideoSampleSink(ctx.videoTrack);
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

        if (ctx.totalDuration > 0) {
          onProgress?.({
            ratio: Math.min(0.99, sample.timestamp / ctx.totalDuration),
            stage: "processing",
          });
        }
      }
      videoSource.close();
    };

    try {
      await ctx.output.start();
      const results = await Promise.allSettled([
        processVideo(),
        processAudioTrack(ctx.audioTrack, audioSource, audioMode, signal),
      ]);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;

      throwIfAborted(signal);
      onProgress?.({ ratio: 1, stage: "finalizing" });
      await ctx.output.finalize();
      ctx.completed = true;
    } catch (err) {
      if (ctx.output.state !== "finalized" && ctx.output.state !== "canceled") {
        await ctx.output.cancel().catch(() => {});
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return finalizeBakeOutput(ctx, outputFileHandle);
  } finally {
    await disposeBakeOutputContext(ctx);
  }
}
