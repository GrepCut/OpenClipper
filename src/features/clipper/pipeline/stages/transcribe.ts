import { transcriptionService } from "../../../../services/transcription.service";
import type { TranscriptionEngine } from "../../../../services/types/transcription.types";
import { extractClipAudioForTranscription } from "../../engine/audio-extract";
import { buildWordCuesForTranscription } from "../../engine/transcript";
import { clipperLog } from "../../shared/logger";
import { computeRmsEnvelope } from "../../engine/audio-envelope";
import { decodeToMono16k } from "../../lib/media/decode-mono-16k";
import type { WordCue } from "../../lib/media/transcription-export";
import type { PipelineReporter } from "../reporter";
import type { ClipperSession } from "../session";

export interface TranscribeStageInput {
  projectId: string;
  snappedStart: number;
  end: number;
  clipDuration: number;
  trimUnchanged: boolean;
  existingWords: WordCue[];
  engine: TranscriptionEngine;
}

async function prepareAudioEnvelope(
  session: ClipperSession,
  snappedStart: number,
  end: number,
  clipDuration: number,
  signal: AbortSignal,
): Promise<File | null> {
  if (session.audioEnvelope) return null;
  try {
    const rangeFile = session.rangeTrimmedFile ?? session.trimmedFile;
    const audioFile = await extractClipAudioForTranscription(
      rangeFile ?? session.sourceFile,
      rangeFile ? 0 : snappedStart,
      rangeFile ? clipDuration : end,
      { signal },
    );
    if (signal.aborted)
      throw new DOMException("Conversion aborted", "AbortError");
    const pcm = await decodeToMono16k(await audioFile.arrayBuffer());
    if (signal.aborted)
      throw new DOMException("Conversion aborted", "AbortError");
    session.audioEnvelope = computeRmsEnvelope(pcm, 16_000);
    clipperLog("transcribe: RMS envelope ready", {
      hops: session.audioEnvelope.values.length,
    });
    return audioFile;
  } catch (error) {
    if (signal.aborted) throw error;
    session.audioEnvelope = null;
    clipperLog(
      "transcribe: RMS envelope unavailable; continuing without silence snap",
      { error: String(error) },
    );
    return null;
  }
}

/** Reuses or fetches transcription for the clip window. */
export async function runTranscribeStage(
  session: ClipperSession,
  input: TranscribeStageInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<WordCue[]> {
  const { snappedStart, end, clipDuration, trimUnchanged, existingWords, engine } =
    input;

  const preparedAudioFile = await prepareAudioEnvelope(
    session,
    snappedStart,
    end,
    clipDuration,
    options.signal,
  );

  if (trimUnchanged && existingWords.length > 0) {
    return existingWords;
  }

  try {
    const existing = await transcriptionService.getTranscription(
      session.mediaFileId,
      {
        clipStartSec: snappedStart,
        clipEndSec: end,
        engine,
      },
    );
    const words = buildWordCuesForTranscription(existing, clipDuration);
    clipperLog("transcribe: reused transcription", {
      wordCount: words.length,
      engine,
    });
    return words;
  } catch {
    const isLocal = engine === "parakeet_local";
    reporter.stage(
      "transcribing",
      isLocal ? "Transcribing speech (Parakeet local)…" : "Transcribing speech (API)…",
    );
    reporter.stageProgress(0);

    const rangeFile = session.rangeTrimmedFile ?? session.trimmedFile;
    const audioFile =
      preparedAudioFile ??
      (await extractClipAudioForTranscription(
        rangeFile ?? session.sourceFile,
        rangeFile ? 0 : snappedStart,
        rangeFile ? clipDuration : end,
        {
          signal: options.signal,
          onProgress: (ratio) => reporter.stageProgress(ratio * 0.55),
        },
      ));
    if (options.signal.aborted)
      throw new DOMException("Conversion aborted", "AbortError");

    reporter.stageProgress(0.6);
    reporter.stage(
      "transcribing",
      isLocal ? "Transcribing speech (Parakeet local)…" : "Transcribing speech (API)…",
    );

    const transcription = await transcriptionService.transcribe(
      audioFile,
      session.mediaFileId,
      input.projectId,
      {
        signal: options.signal,
        summarize: false,
        audioDurationSeconds: clipDuration,
        clipStartSec: snappedStart,
        clipEndSec: end,
        engine,
        onParakeetProgress: isLocal
          ? (progress) => {
              reporter.stageProgress(0.6 + progress.ratio * 0.4);
              reporter.stage(
                "transcribing",
                `Transcribing (Parakeet, chunk ${progress.chunkIndex + 1}/${progress.chunkCount})…`,
              );
            }
          : undefined,
      },
    );
    if (options.signal.aborted)
      throw new DOMException("Conversion aborted", "AbortError");
    reporter.stageProgress(1);
    return buildWordCuesForTranscription(transcription, clipDuration);
  }
}
