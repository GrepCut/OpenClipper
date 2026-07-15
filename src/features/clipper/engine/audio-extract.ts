import { Mp3OutputFormat } from "mediabunny";
import { convertWithMediabunnyBuffer } from '../lib/convert/engines';
import { ensureMp3Encoder } from "../lib/convert/mp3-encoder";
import { clipperLog, formatBytes } from "../shared/logger";

/** Mono speech MP3 — compact for API upload (Whisper accepts MP3; WAV PCM is far larger). */
const TRANSCRIBE_MP3_BITRATE = 64_000;

/**
 * Extracts mono MP3 for transcription from a video file using Mediabunny.
 */
export async function extractClipAudioForTranscription(
  file: File,
  startSec: number,
  endSec: number,
  options: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {},
): Promise<File> {
  clipperLog("audio: extracting MP3 via mediabunny", { startSec, endSec, fileName: file.name });

  await ensureMp3Encoder();

  const buffer = await convertWithMediabunnyBuffer(
    file,
    {
      createFormat: () => new Mp3OutputFormat(),
      mimeType: "audio/mpeg",
      video: { discard: true },
      audio: {
        codec: "mp3",
        bitrate: TRANSCRIBE_MP3_BITRATE,
        numberOfChannels: 1,
        sampleRate: 16_000,
      },
      trim: { start: startSec, end: endSec },
      stage: "extracting",
    },
    {
      signal: options.signal,
      onProgress: ({ ratio }) => options.onProgress?.(ratio ?? 0),
    },
  );

  if (!buffer || buffer.byteLength <= 0) {
    throw new Error(
      "Could not extract audio from this clip. The file may be silent or use an unsupported codec.",
    );
  }

  const mp3File = new File([buffer], "clip-audio.mp3", { type: "audio/mpeg" });
  clipperLog("audio: MP3 ready", { size: formatBytes(mp3File.size) });
  return mp3File;
}
