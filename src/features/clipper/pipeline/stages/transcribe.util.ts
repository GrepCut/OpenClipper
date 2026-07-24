import { transcriptionService } from "../../../../services/transcription.service";
import {
  computeRmsEnvelope,
  extractClipAudioForTranscription,
  type PreparedTranscriptionAudio,
} from "../../engine/audio";
import { buildWordCuesForTranscription } from "../../engine/transcript";
import { clipperLog } from "../../shared/logger.util";
import type { WordCue } from "../../lib/media/transcription-export.util";
import type { PipelineReporter } from "../reporter.util";
import type { ClipperSession } from "../session.util";

export interface TranscribeStageInput {
  projectId: string;
  snappedStart: number;
  end: number;
  clipDuration: number;
  trimUnchanged: boolean;
  existingWords: WordCue[];
}

async function prepareAudioEnvelope(
  session: ClipperSession,
  snappedStart: number,
  end: number,
  clipDuration: number,
  signal: AbortSignal,
): Promise<PreparedTranscriptionAudio | null> {
  if (session.audioEnvelope) return null;
  try {
    const rangeFile = session.rangeTrimmedFile ?? session.trimmedFile;
    const preparedAudio = await extractClipAudioForTranscription(
      rangeFile ?? session.sourceFile,
      rangeFile ? 0 : snappedStart,
      rangeFile ? clipDuration : end,
      { signal },
    );
    if (signal.aborted)
      throw new DOMException("Conversion aborted", "AbortError");
    session.audioEnvelope = computeRmsEnvelope(preparedAudio.pcm16k, 16_000);
    clipperLog("transcribe: RMS envelope ready", {
      hops: session.audioEnvelope.values.length,
    });
    return preparedAudio;
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
  const {
    snappedStart,
    end,
    clipDuration,
    trimUnchanged,
    existingWords,
  } = input;

  const preparedAudio = await prepareAudioEnvelope(
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
      },
    );
    const words = buildWordCuesForTranscription(existing, clipDuration);
    clipperLog("transcribe: reused transcription", {
      wordCount: words.length,
      engine: "parakeet_local",
    });
    return words;
  } catch {
    reporter.stage(
      "transcribing",
      "Transcribing speech (Parakeet local)…",
    );
    reporter.stageProgress(0);

    const rangeFile = session.rangeTrimmedFile ?? session.trimmedFile;
    const transcriptionAudio =
      preparedAudio ??
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
      "Transcribing speech (Parakeet local)…",
    );

    const transcription = await transcriptionService.transcribe(
      transcriptionAudio.file,
      session.mediaFileId,
      input.projectId,
      {
        signal: options.signal,
        clipStartSec: snappedStart,
        clipEndSec: end,
        pcm16k: transcriptionAudio.pcm16k,
        onParakeetProgress: (progress) => {
          reporter.stageProgress(0.6 + progress.ratio * 0.4);
          reporter.stage(
            "transcribing",
            `Transcribing (Parakeet, chunk ${progress.chunkIndex + 1}/${progress.chunkCount})…`,
          );
        },
      },
    );
    if (options.signal.aborted)
      throw new DOMException("Conversion aborted", "AbortError");
    reporter.stageProgress(1);
    return buildWordCuesForTranscription(transcription, clipDuration);
  }
}
