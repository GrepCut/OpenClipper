import {
  ALL_FORMATS,
  BufferTarget,
  Conversion,
  Input,
  Mp3OutputFormat,
  Output,
  UrlSource,
} from "mediabunny";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ensureMp3Encoder } from "../features/clipper/lib/convert/mp3-encoder.util";
import { GROQ_MAX_UPLOAD_BYTES } from "./cloud-transcription.service";

export const CLOUD_MP3_BITRATE = 64_000;
export const CLOUD_UPLOAD_TARGET_BYTES = Math.floor(GROQ_MAX_UPLOAD_BYTES * 0.85);
export const CLOUD_MP3_BYTES_PER_SECOND = CLOUD_MP3_BITRATE / 8;

export interface CloudAudioChunkWindow {
  startSec: number;
  endSec: number;
}

export interface PreparedCloudAudioChunk extends CloudAudioChunkWindow {
  index: number;
  bytes: Uint8Array;
}

export function planCloudAudioChunks(durationSec: number): CloudAudioChunkWindow[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return [{ startSec: 0, endSec: 0 }];
  }
  const maxChunkDurationSec = Math.max(
    30,
    Math.floor(CLOUD_UPLOAD_TARGET_BYTES / CLOUD_MP3_BYTES_PER_SECOND),
  );
  if (durationSec <= maxChunkDurationSec) {
    return [{ startSec: 0, endSec: durationSec }];
  }
  const chunks: CloudAudioChunkWindow[] = [];
  let start = 0;
  while (start < durationSec) {
    const end = Math.min(durationSec, start + maxChunkDurationSec);
    chunks.push({ startSec: start, endSec: end });
    start = end;
  }
  return chunks;
}

export async function encodeCloudAudioChunkMp3(
  wavPath: string,
  startSec: number,
  endSec: number,
  options?: { signal?: AbortSignal },
): Promise<Uint8Array> {
  if (options?.signal?.aborted) {
    throw new DOMException("Conversion aborted", "AbortError");
  }
  await ensureMp3Encoder();
  const input = new Input({
    source: new UrlSource(convertFileSrc(wavPath)),
    formats: ALL_FORMATS,
  });
  const bufferTarget = new BufferTarget();
  const output = new Output({
    format: new Mp3OutputFormat(),
    target: bufferTarget,
  });
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: {
      codec: "mp3",
      bitrate: CLOUD_MP3_BITRATE,
      numberOfChannels: 1,
      sampleRate: 16_000,
      forceTranscode: true,
    },
    trim: { start: startSec, end: endSec },
  });
  if (!conversion.isValid) {
    throw new Error("Cloud audio compression failed to initialize.");
  }
  await conversion.execute();
  if (options?.signal?.aborted) {
    throw new DOMException("Conversion aborted", "AbortError");
  }
  const buffer = bufferTarget.buffer;
  if (!buffer) {
    throw new Error("Cloud audio compression produced no output.");
  }
  return new Uint8Array(buffer);
}

export async function prepareCloudAudioChunks(
  wavPath: string,
  durationSec: number,
  options?: {
    signal?: AbortSignal;
    onProgress?: (ratio: number, chunkIndex: number, chunkCount: number) => void;
  },
): Promise<PreparedCloudAudioChunk[]> {
  const windows = planCloudAudioChunks(durationSec);
  const results: PreparedCloudAudioChunk[] = [];
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]!;
    if (options?.signal?.aborted) {
      throw new DOMException("Conversion aborted", "AbortError");
    }
    const bytes = await encodeCloudAudioChunkMp3(
      wavPath,
      window.startSec,
      window.endSec,
      options,
    );
    if (bytes.byteLength > GROQ_MAX_UPLOAD_BYTES) {
      throw new Error(
        `Compressed audio chunk ${index + 1}/${windows.length} is still too large for Groq (${Math.ceil(bytes.byteLength / (1024 * 1024))} MB). Try a shorter clip.`,
      );
    }
    results.push({
      index,
      startSec: window.startSec,
      endSec: window.endSec,
      bytes,
    });
    options?.onProgress?.((index + 1) / windows.length, index, windows.length);
  }
  return results;
}
