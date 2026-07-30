import {
  AudioSampleSink,
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";
import { createMediabunnyInput } from "../../lib/media/mediabunny-file-source.util";
import {
  createAudioSource,
  AAC_BITRATE,
  FrameCanvasCache,
  highQualityVideoBitrate,
  processAudioTrack,
  renderSizedEffectFrame,
  resolveVideoSourceSize,
  throwIfAborted,
  type FrameEffectSize,
  type InputAudioTrack,
} from "../../lib/media/video-frame-effect.util";
import { EncodeBackpressure } from "../../lib/media/encode-backpressure.util";
import { clipperError } from "../../shared/logger.util";
import type { ClipperFormatDef, ClipperPlatform } from "../../shared/formats.util";
import type { ClipperQualityPreset } from "../../settings/settings.util";
import type { ClipperClipWindow, RenderClipperResult } from "../types/render.types";
import { segmentsTotalDuration } from "../segmentation/clip-time.util";
import {
  drawClipperFrame,
  resolveClipperOutputSize,
} from "./frame-draw.util";
import { resolveClipperFrameGeometry } from "./frame-geometry.util";
import type { ClipperFrameContext } from "../types/render.types";
import { rebaseVideoSampleForWindow } from "./windowed-video.util";
import { applySeamFades, trimAudioSampleToWindow } from "../audio/windowed-samples.util";
import { ensureCaptionFontsReady } from "../../lib/captions/caption-presets.util";
import { evenInt } from "../../lib/media/video-draw.util";

const QUALITY_BITRATE_MULTIPLIER: Record<ClipperQualityPreset, number> = {
  draft: 0.55,
  standard: 1,
  high: 1.6,
};

function resolveEncodeBitrate(output: FrameEffectSize, quality: ClipperQualityPreset): number {
  const base = highQualityVideoBitrate(output.width, output.height);
  return Math.ceil((base * QUALITY_BITRATE_MULTIPLIER[quality]) / 1000) * 1000;
}

/**
 * Crop + scale a VideoFrame without Canvas 2D (WebCodecs visibleRect path).
 * Falls back to null when the crop rect is invalid for VideoFrame constraints.
 */
function cropScaleVideoFrame(
  frame: VideoFrame,
  crop: { sx: number; sy: number; sw: number; sh: number },
  output: FrameEffectSize,
  timestamp: number,
  duration: number | undefined,
): VideoFrame | null {
  const codedW = frame.codedWidth || frame.displayWidth;
  const codedH = frame.codedHeight || frame.displayHeight;
  let x = Math.max(0, Math.floor(crop.sx));
  let y = Math.max(0, Math.floor(crop.sy));
  let width = evenInt(Math.max(2, Math.floor(crop.sw)));
  let height = evenInt(Math.max(2, Math.floor(crop.sh)));
  if (x + width > codedW) width = evenInt(Math.max(2, codedW - x));
  if (y + height > codedH) height = evenInt(Math.max(2, codedH - y));
  if (width < 2 || height < 2) return null;
  // WebCodecs requires even offsets for many YUV formats.
  x = evenInt(x);
  y = evenInt(y);
  if (x + width > codedW || y + height > codedH) return null;
  try {
    return new VideoFrame(frame, {
      timestamp,
      duration,
      visibleRect: { x, y, width, height },
      displayWidth: output.width,
      displayHeight: output.height,
    });
  } catch {
    return null;
  }
}

/**
 * Streams the audio track for one or more disjoint source windows into
 * `audioSource`, concatenating them into one continuous output timeline
 * (no gaps between segments, matching the video track's stitching).
 */
async function processAudioTrackInWindow(
  audioTrack: InputAudioTrack | null,
  audioSource: AudioSampleSource | null,
  window: ClipperClipWindow,
  signal?: AbortSignal,
): Promise<void> {
  if (!audioTrack || !audioSource) return;
  const segments = window.segments;
  if (!segments.length) {
    audioSource.close();
    return;
  }

  const sampleSink = new AudioSampleSink(audioTrack);
  let cumulativeOutputSec = 0;

  for (const segment of segments) {
    const { startSec, endSec } = segment;
    let pending: AudioSample | null = null;
    let first = true;
    for await (const audioSample of sampleSink.samples(startSec, endSec)) {
      throwIfAborted(signal);
      try {
        const trim = trimAudioSampleToWindow(audioSample.timestamp, audioSample.duration, startSec, endSec);
        if (!trim) continue;
        const frameOffset = Math.max(0, Math.ceil(trim.offsetSec * audioSample.sampleRate - 1e-9));
        const frameEnd = Math.min(
          audioSample.numberOfFrames,
          Math.floor((trim.offsetSec + trim.durationSec) * audioSample.sampleRate + 1e-9),
        );
        const frameCount = frameEnd - frameOffset;
        if (frameCount <= 0) continue;
        const pcm = new Float32Array(frameCount * audioSample.numberOfChannels);
        audioSample.copyTo(pcm, { planeIndex: 0, format: "f32", frameOffset, frameCount });
        if (first) {
          applySeamFades(pcm, audioSample.numberOfChannels, audioSample.sampleRate, 0.006, 0);
          first = false;
        }
        const processed = new AudioSample({
          data: pcm,
          format: "f32",
          numberOfChannels: audioSample.numberOfChannels,
          sampleRate: audioSample.sampleRate,
          timestamp: cumulativeOutputSec + trim.outputTimestampSec,
        });
        if (pending) {
          await audioSource.add(pending);
          pending.close();
        }
        pending = processed;
      } finally {
        audioSample.close();
      }
    }
    if (pending) {
      const pcm = new Float32Array(pending.numberOfFrames * pending.numberOfChannels);
      pending.copyTo(pcm, { planeIndex: 0, format: "f32" });
      applySeamFades(pcm, pending.numberOfChannels, pending.sampleRate, 0, 0.006);
      const faded = new AudioSample({ data: pcm, format: "f32", numberOfChannels: pending.numberOfChannels,
        sampleRate: pending.sampleRate, timestamp: pending.timestamp });
      pending.close();
      await audioSource.add(faded);
      faded.close();
    }
    cumulativeOutputSec += Math.max(0, endSec - startSec);
  }
  audioSource.close();
}

/** Encodes one export format from a trimmed clip file (optionally one or more sub-windows of a longer range file). */
export async function renderClipperFormat(
  trimmedFile: File,
  formatDef: ClipperFormatDef,
  render: ClipperFrameContext,
  options: {
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
    clipWindow?: ClipperClipWindow;
    outputSink?: WritableStream<StreamTargetChunk>;
  } = {},
): Promise<RenderClipperResult> {
  const { signal, onProgress, clipWindow, outputSink } = options;
  throwIfAborted(signal);
  await ensureCaptionFontsReady();
  throwIfAborted(signal);

  const input = await createMediabunnyInput(trimmedFile);
  const toFile = Boolean(outputSink);
  const target = toFile
    ? new StreamTarget(outputSink!, { chunked: true })
    : new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: toFile ? false : "in-memory" });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("No video track found.");
    const audioTrack = (await input.getAudioTracks())[0] ?? null;
    const totalDuration = await input.computeDuration();

    const windowDuration = clipWindow
      ? Math.max(0.001, segmentsTotalDuration(clipWindow.segments))
      : Math.max(0.001, totalDuration);

    const sourceSize = await resolveVideoSourceSize(videoTrack);
    const outputSize = resolveClipperOutputSize(formatDef, render.settings.formats.resolutionCap);

    const output = new Output({ format, target });
    const videoSource = new VideoSampleSource({
      codec: "avc",
      bitrate: resolveEncodeBitrate(outputSize, render.settings.formats.quality),
      // Offline export: prefer quality (no frame drops) + hardware when available.
      latencyMode: "quality",
      hardwareAcceleration: "prefer-hardware",
    });
    output.addVideoTrack(videoSource);

    const { audioSource, audioMode } = clipWindow && audioTrack
      ? { audioSource: new AudioSampleSource({ codec: "aac", bitrate: AAC_BITRATE }), audioMode: "transcode" as const }
      : createAudioSource(audioTrack);
    if (audioSource) output.addAudioTrack(audioSource);

    const onAbort = () => {
      void output.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const canvasCache = new FrameCanvasCache();
    const encodeBackpressure = new EncodeBackpressure();
    const skipCanvas = !render.settings.captions.enabled;

    const encodeSample = async (
      sample: VideoSample,
      sourceTimestamp: number,
      outputTimestamp: number,
      outputDuration: number,
    ): Promise<void> => {
      const frame = sample.toVideoFrame();
      try {
        let base: VideoFrame | null = null;
        if (skipCanvas) {
          const geometry = resolveClipperFrameGeometry(
            formatDef,
            { width: frame.displayWidth, height: frame.displayHeight },
            outputSize,
            sourceTimestamp,
            render,
          );
          if (geometry.mode === "single-crop" && geometry.panels.length === 1) {
            base = cropScaleVideoFrame(
              frame,
              geometry.panels[0]!.source,
              outputSize,
              frame.timestamp,
              frame.duration ?? undefined,
            );
          }
        }
        if (!base) {
          base = renderSizedEffectFrame(
            frame,
            outputSize,
            (ctx, videoFrame, source, out) => {
              drawClipperFrame(formatDef, ctx, videoFrame, source, out, sourceTimestamp, render);
            },
            canvasCache,
          );
        }
        try {
          const outSample = new VideoSample(base, {
            timestamp: outputTimestamp,
            duration: outputDuration,
          });
          try {
            await encodeBackpressure.run(() => videoSource.add(outSample));
          } finally {
            outSample.close();
          }
        } finally {
          base.close();
        }
      } finally {
        frame.close();
      }
    };

    const processVideo = async (): Promise<void> => {
      const sink = new VideoSampleSink(videoTrack);

      if (!clipWindow) {
        for await (const sample of sink.samples()) {
          throwIfAborted(signal);
          const t = sample.timestamp;
          try {
            await encodeSample(sample, t, t, sample.duration);
          } finally {
            sample.close();
          }
          onProgress?.(Math.min(0.99, t / windowDuration));
        }
        videoSource.close();
        return;
      }

      let cumulativeOutputSec = 0;
      for (const segment of clipWindow.segments) {
        const { startSec: segStart, endSec: segEnd } = segment;

        for await (const sample of sink.samples(segStart, segEnd)) {
          throwIfAborted(signal);

          const t = sample.timestamp;
          const sampleEnd = t + sample.duration;
          if (sampleEnd <= segStart) {
            sample.close();
            continue;
          }
          if (t >= segEnd) {
            sample.close();
            break;
          }

          const rebased = rebaseVideoSampleForWindow(t, sample.duration, segStart, segEnd);
          if (!rebased) {
            sample.close();
            continue;
          }

          const outputTimestamp = Math.max(0, cumulativeOutputSec + rebased.timestamp);
          try {
            await encodeSample(sample, t, outputTimestamp, rebased.duration);
          } finally {
            sample.close();
          }

          onProgress?.(Math.min(0.99, outputTimestamp / windowDuration));
        }
        cumulativeOutputSec += Math.max(0, segEnd - segStart);
      }
      videoSource.close();
    };

    try {
      onProgress?.(0);
      await output.start();
      const audioPromise = clipWindow
        ? processAudioTrackInWindow(audioTrack, audioSource as AudioSampleSource | null, clipWindow, signal)
        : processAudioTrack(audioTrack, audioSource, audioMode, signal);

      const results = await Promise.allSettled([processVideo(), audioPromise]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;

      throwIfAborted(signal);
      await output.finalize();
    } catch (error) {
      if (output.state !== "finalized" && output.state !== "canceled") {
        await output.cancel().catch(() => {});
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (toFile) {
      return { kind: "disk-encoded" };
    }
    if (!(target instanceof BufferTarget) || !target.buffer) {
      throw new Error("Render produced no output.");
    }
    return { kind: "memory", blob: new Blob([target.buffer], { type: "video/mp4" }) };
  } finally {
    input.dispose();
  }
}
