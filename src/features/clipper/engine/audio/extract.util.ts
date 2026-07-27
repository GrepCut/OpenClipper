import { WavOutputFormat } from "mediabunny";
import { convertWithMediabunnyBuffer } from "../../lib/convert/mediabunny-convert.util";
import { clipperLog, formatBytes } from "../../shared/logger.util";
import type { PreparedTranscriptionAudio } from "../types/audio.types";
import {
  appendRmsSamples,
  createRmsEnvelopeAccumulator,
  finishRmsEnvelope,
} from "./envelope.util";

const TRANSCRIBE_SAMPLE_RATE = 16_000;

/**
 * Extracts mono 16 kHz PCM WAV for the local recognizer. MP3 encoding was
 * unused by local transcription and consumed CPU on long clips.
 */
export async function extractClipAudioForTranscription(
  file: File,
  startSec: number,
  endSec: number,
  options: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {},
): Promise<PreparedTranscriptionAudio> {
  clipperLog("audio: extracting PCM WAV via mediabunny", {
    startSec,
    endSec,
    fileName: file.name,
  });

  const envelope = createRmsEnvelopeAccumulator(TRANSCRIBE_SAMPLE_RATE);

  const buffer = await convertWithMediabunnyBuffer(
    file,
    {
      createFormat: () => new WavOutputFormat(),
      mimeType: "audio/wav",
      video: { discard: true },
      audio: {
        codec: "pcm-s16",
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
          appendRmsSamples(envelope, pcmChunk);
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

  const audioEnvelope = finishRmsEnvelope(envelope, TRANSCRIBE_SAMPLE_RATE);
  if (audioEnvelope.values.length === 0) {
    throw new Error(
      "Could not decode audio from this clip. The file may be silent or use an unsupported codec.",
    );
  }

  const wavBytes = new Uint8Array(buffer);
  clipperLog("audio: PCM WAV ready", {
    wavSize: formatBytes(wavBytes.byteLength),
    rmsHops: audioEnvelope.values.length,
  });
  return { wavBytes, audioEnvelope };
}
