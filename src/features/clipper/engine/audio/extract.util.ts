import { WavOutputFormat, Output, StreamTarget } from "mediabunny";
import { isTauri } from "../../../../shared/utils/platform.util";
import { createMediabunnyInput } from "../../lib/media/mediabunny-file-source.util";
import { createThrottledProgressReporter } from "../../lib/convert/throttled-progress.util";
import { createClipperTranscriptionAudioSink } from "../../persistence/transcription-audio-sink.util";
import { clipperLog } from "../../shared/logger.util";
import type { PreparedTranscriptionAudio } from "../types/audio.types";
import {
  appendRmsSamples,
  createRmsEnvelopeAccumulator,
  finishRmsEnvelope,
} from "./envelope.util";

const TRANSCRIBE_SAMPLE_RATE = 16_000;

export class NoTranscribableAudioError extends Error {
  constructor(message = "No audio track in this file.") {
    super(message);
    this.name = "NoTranscribableAudioError";
  }
}

/** Returns false for video-only files (no primary audio track). */
export async function hasTranscribableAudioTrack(file: File): Promise<boolean> {
  const input = await createMediabunnyInput(file);
  try {
    return (await input.getPrimaryAudioTrack()) != null;
  } finally {
    input.dispose();
  }
}

function isVideoOnlyConversion(conversion: {
  discardedTracks: Array<{ track: { type: string }; reason: string }>;
}): boolean {
  const { discardedTracks } = conversion;
  const audioTracks = discardedTracks.filter((entry) => entry.track.type === "audio");
  return (
    discardedTracks.length > 0 &&
    discardedTracks.every((entry) => entry.reason === "discarded_by_user") &&
    audioTracks.length === 0
  );
}

const mediabunnyAudioConfig = {
  codec: "pcm-s16" as const,
  numberOfChannels: 1,
  sampleRate: TRANSCRIBE_SAMPLE_RATE,
};

/**
 * Extracts mono 16 kHz PCM WAV for the local recognizer. In Tauri, streams
 * directly to project data on disk instead of holding the full WAV in RAM.
 */
export async function extractClipAudioForTranscription(
  file: File,
  startSec: number,
  endSec: number,
  options: {
    projectId: string;
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
  },
): Promise<PreparedTranscriptionAudio> {
  clipperLog("audio: extracting PCM WAV via mediabunny", {
    startSec,
    endSec,
    fileName: file.name,
    streamToDisk: isTauri(),
  });

  const envelope = createRmsEnvelopeAccumulator(TRANSCRIBE_SAMPLE_RATE);
  const processSample = (sample: {
    numberOfChannels: number;
    sampleRate: number;
    numberOfFrames: number;
    copyTo: (destination: Float32Array, options: { format: "f32"; planeIndex: number }) => void;
  }) => {
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
  };

  const convertConfig = {
    createFormat: () => new WavOutputFormat(),
    mimeType: "audio/wav",
    video: { discard: true },
    audio: {
      ...mediabunnyAudioConfig,
      process: processSample,
    },
    trim: { start: startSec, end: endSec },
    stage: "extracting" as const,
  };

  if (!isTauri()) {
    throw new Error("Local transcription audio extraction requires the desktop app.");
  }

  const sink = await createClipperTranscriptionAudioSink(options.projectId);
  const target = new StreamTarget(sink.writable, { chunked: true });
  const input = await createMediabunnyInput(file);
  const progress = createThrottledProgressReporter((progress) =>
    options.onProgress?.(progress.ratio ?? 0),
  );

  let audioPath: string;
  try {
    if ((await input.getPrimaryAudioTrack()) == null) {
      throw new NoTranscribableAudioError();
    }

    progress.report({ ratio: null, stage: "reading" });
    const output = new Output({ format: new WavOutputFormat(), target });
    const { Conversion } = await import("mediabunny");
    const conversion = await Conversion.init({
      input,
      output,
      video: convertConfig.video,
      audio: convertConfig.audio,
      trim: convertConfig.trim,
    });
    if (!conversion.isValid) {
      if (isVideoOnlyConversion(conversion)) {
        throw new NoTranscribableAudioError();
      }
      throw new Error("Could not convert audio for transcription.");
    }
    conversion.onProgress = (ratio) =>
      progress.report({ ratio, stage: convertConfig.stage });
    const cancelConversion = () => void conversion.cancel();
    options.signal?.addEventListener("abort", cancelConversion, { once: true });
    try {
      await conversion.execute();
    } finally {
      options.signal?.removeEventListener("abort", cancelConversion);
    }
    if (options.signal?.aborted) {
      throw new DOMException("Conversion aborted", "AbortError");
    }
    progress.report({ ratio: 1, stage: "finalizing" });
    audioPath = await sink.finalize();
  } finally {
    input.dispose();
    progress.dispose();
  }

  const audioEnvelope = finishRmsEnvelope(envelope, TRANSCRIBE_SAMPLE_RATE);
  if (audioEnvelope.values.length === 0) {
    throw new Error(
      "Could not decode audio from this clip. The file may be silent or use an unsupported codec.",
    );
  }

  clipperLog("audio: PCM WAV ready on disk", {
    audioPath,
    rmsHops: audioEnvelope.values.length,
  });
  return { audioPath, audioEnvelope };
}
