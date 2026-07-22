import { Mp3OutputFormat } from "mediabunny";
import { convertWithMediabunnyBuffer } from "../../lib/convert/mediabunny-convert.util";
import { ensureMp3Encoder } from "../../lib/convert/mp3-encoder.util";
import { clipperLog, formatBytes } from "../../shared/logger.util";
import type { PreparedTranscriptionAudio } from "../types/audio.types";

/** Mono speech MP3 — compact for API upload (Whisper accepts MP3; WAV PCM is far larger). */
const TRANSCRIBE_MP3_BITRATE = 64_000;
const TRANSCRIBE_SAMPLE_RATE = 16_000;

function concatenatePcmChunks(
  chunks: Float32Array[],
  sampleCount: number,
): Float32Array {
  const pcm = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }
  return pcm;
}

/**
 * Extracts mono MP3 for transcription from a video file using Mediabunny.
 */
export async function extractClipAudioForTranscription(
  file: File,
  startSec: number,
  endSec: number,
  options: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {},
): Promise<PreparedTranscriptionAudio> {
  clipperLog("audio: extracting MP3 via mediabunny", {
    startSec,
    endSec,
    fileName: file.name,
  });

  await ensureMp3Encoder();

  const pcmChunks: Float32Array[] = [];
  let pcmSampleCount = 0;

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
        sampleRate: TRANSCRIBE_SAMPLE_RATE,
        process: (sample) => {
          if (
            sample.numberOfChannels !== 1 ||
            sample.sampleRate !== TRANSCRIBE_SAMPLE_RATE
          ) {
            throw new Error(
              "Transcription audio was not converted to mono 16 kHz PCM.",
            );
          }
          const pcmChunk = new Float32Array(sample.numberOfFrames);
          sample.copyTo(pcmChunk, { format: "f32", planeIndex: 0 });
          pcmChunks.push(pcmChunk);
          pcmSampleCount += pcmChunk.length;
          return sample;
        },
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

  if (pcmSampleCount <= 0) {
    throw new Error(
      "Could not decode audio from this clip. The file may be silent or use an unsupported codec.",
    );
  }

  const mp3File = new File([buffer], "clip-audio.mp3", { type: "audio/mpeg" });
  const pcm16k = concatenatePcmChunks(pcmChunks, pcmSampleCount);
  clipperLog("audio: MP3 + PCM ready", {
    mp3Size: formatBytes(mp3File.size),
    pcmSamples: pcm16k.length,
  });
  return { file: mp3File, pcm16k };
}
