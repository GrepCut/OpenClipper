/**
 * Extracts a single decoded frame from a video File via Mediabunny (WebCodecs),
 * for use as a still-image preview. Uses `VideoSampleSink.getSample()` for
 * random access instead of decoding the whole track like `video-frame-effect.ts` does.
 */
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import { createMediabunnyInput } from "./mediabunny-file-source.util";

export type FramePosition = "start" | "middle" | "end";

export interface ExtractedVideoFrame {
  imageData: ImageData;
  width: number;
  height: number;
}

async function resolveTimestamp(
  input: Input,
  position: FramePosition,
): Promise<number> {
  if (position === "start") return 0;
  const duration = await input.computeDuration();
  if (position === "middle") return duration / 2;
  return Math.max(0, duration - 0.05);
}

/** Returns a single frame at native resolution as `ImageData`. */
export async function extractRawVideoFrame(
  file: File,
  position: FramePosition,
): Promise<ExtractedVideoFrame> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No video track found in this file.");
    }
    const sink = new VideoSampleSink(videoTrack);
    const timestamp = await resolveTimestamp(input, position);

    let sample = await sink.getSample(timestamp);
    if (!sample && position === "end") {
      sample = await sink.getSample(0);
    }
    if (!sample) {
      throw new Error("Could not read a frame from this video.");
    }

    try {
      const frame = sample.toVideoFrame();
      try {
        const width = frame.displayWidth;
        const height = frame.displayHeight;

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not create 2D canvas for frame preview.");
        ctx.drawImage(frame, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        return { imageData, width, height };
      } finally {
        frame.close();
      }
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}

/** Downscales so the longest side is at most `maxDimension`, keeping aspect ratio. */
export async function extractVideoFrame(
  file: File,
  position: FramePosition,
  maxDimension = 960,
): Promise<ExtractedVideoFrame> {
  const raw = await extractRawVideoFrame(file, position);
  return downscaleExtractedFrame(raw, maxDimension);
}

async function encodeVideoFrameAsJpeg(frame: VideoFrame, quality = 0.92): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a canvas for frame export.");
  ctx.drawImage(frame, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  if (!blob) throw new Error("Could not encode a video frame as JPEG.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Returns a single decoded frame at `timestampSec` as JPEG bytes (WebCodecs, not HTML video). */
export async function extractVideoFrameJpeg(
  file: File,
  timestampSec: number,
  quality = 0.92,
): Promise<Uint8Array> {
  const input = await createMediabunnyInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("No video track found in this file.");
    const sink = new VideoSampleSink(videoTrack);
    const duration = await input.computeDuration();
    const clampedTime = duration > 0.05
      ? Math.max(0, Math.min(timestampSec, duration - 0.05))
      : Math.max(0, timestampSec);
    const sample = await sink.getSample(clampedTime);
    if (!sample) throw new Error(`Could not read a frame at ${clampedTime.toFixed(2)}s.`);
    try {
      const frame = sample.toVideoFrame();
      try {
        return await encodeVideoFrameAsJpeg(frame, quality);
      } finally {
        frame.close();
      }
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}

export function downscaleExtractedFrame(
  frame: ExtractedVideoFrame,
  maxDimension: number,
): ExtractedVideoFrame {
  const { imageData, width: sourceWidth, height: sourceHeight } = frame;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  if (scale >= 1) {
    return frame;
  }

  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D canvas for frame preview.");

  const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) throw new Error("Could not create 2D canvas for frame preview.");
  sourceCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(sourceCanvas, 0, 0, width, height);

  return { imageData: ctx.getImageData(0, 0, width, height), width, height };
}
