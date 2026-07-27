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

const PREPARE_WEIGHT = 0.3;
const LOAD_END = 0.45;
const INFER_WEIGHT = 0.55;

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
    // Fall through to local Parakeet run.
  }

  reporter.stage("transcribing", "Transcribing speech (Parakeet local)…");
  reporter.stageProgress(0);
  reporter.stageDetail("Preparing audio", 0);

  const rangeFile = session.rangeTrimmedFile ?? session.trimmedFile;
  let transcriptionAudio: PreparedTranscriptionAudio;
  try {
    transcriptionAudio = await extractClipAudioForTranscription(
      rangeFile ?? session.sourceFile,
      rangeFile ? 0 : snappedStart,
      rangeFile ? clipDuration : end,
      {
        signal: options.signal,
        onProgress: (ratio) => {
          reporter.stageProgress(ratio * PREPARE_WEIGHT);
          reporter.stageDetail("Preparing audio", ratio);
        },
      },
    );
  } catch (error) {
    if (options.signal.aborted) throw error;
    session.audioEnvelope = null;
    clipperLog(
      "transcribe: audio extract failed",
      { error: String(error) },
    );
    throw error;
  }
  if (options.signal.aborted)
    throw new DOMException("Conversion aborted", "AbortError");

  if (!session.audioEnvelope) {
    try {
      session.audioEnvelope = computeRmsEnvelope(transcriptionAudio.pcm16k, 16_000);
      clipperLog("transcribe: RMS envelope ready", {
        hops: session.audioEnvelope.values.length,
      });
    } catch (error) {
      session.audioEnvelope = null;
      clipperLog(
        "transcribe: RMS envelope unavailable; continuing without silence snap",
        { error: String(error) },
      );
    }
  }

  reporter.stageProgress(PREPARE_WEIGHT);
  reporter.stageDetail("Loading speech model", null);
  reporter.stage("transcribing", "Loading speech model…");

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
        if (progress.phase === "loading") {
          if (progress.ratio >= 1) {
            reporter.stageProgress(LOAD_END);
            reporter.stageDetail("Transcribing speech", null);
            reporter.stage("transcribing", "Transcribing speech…");
          } else {
            reporter.stageProgress(PREPARE_WEIGHT);
            reporter.stageDetail("Loading speech model", null);
            reporter.stage("transcribing", "Loading speech model…");
          }
          return;
        }

        if (progress.phase === "releasing") {
          reporter.stageProgress(1);
          reporter.stageDetail("Releasing speech model", null);
          reporter.stage("transcribing", "Releasing speech model…");
          return;
        }

        reporter.stageProgress(LOAD_END + progress.ratio * INFER_WEIGHT);
        const chunkLabel =
          progress.chunkCount > 0
            ? `Transcribing chunk ${progress.chunkIndex + 1}/${progress.chunkCount}`
            : "Transcribing speech";
        reporter.stageDetail(chunkLabel, progress.ratio);
        reporter.stage(
          "transcribing",
          progress.chunkCount > 0
            ? `Transcribing (Parakeet, chunk ${progress.chunkIndex + 1}/${progress.chunkCount})…`
            : "Transcribing speech…",
        );
      },
    },
  );
  if (options.signal.aborted)
    throw new DOMException("Conversion aborted", "AbortError");

  reporter.stageProgress(1);
  reporter.stageDetail(null, null);
  return buildWordCuesForTranscription(transcription, clipDuration);
}
