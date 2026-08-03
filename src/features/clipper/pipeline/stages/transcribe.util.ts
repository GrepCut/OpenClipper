import {
  transcriptionService,
  isCloudTranscriptionEngine,
  type LocalTranscriptionEngine,
} from "../../../../services/transcription.service";
import {
  extractClipAudioForTranscription,
  hasTranscribableAudioTrack,
  NoTranscribableAudioError,
  type PreparedTranscriptionAudio,
} from "../../engine/audio";
import { buildWordCuesForTranscription } from "../../engine/transcript";
import { clipperLog } from "../../shared/logger.util";
import {
  createTranscriptionDiagRunId,
  logTranscriptionDiag,
} from "../../../../shared/utils/transcription-diag-log.util";
import { loadClipperSettings } from "../../settings/settings-storage.util";
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
  transcriptionEngine?: LocalTranscriptionEngine;
}

const PREPARE_WEIGHT = 0.3;
const LOAD_END = 0.45;
const INFER_WEIGHT = 0.55;

function transcriptionModelLabel(engine: LocalTranscriptionEngine): string {
  if (engine === "whisper") return "Whisper Turbo local";
  if (engine === "groq") return "Groq Whisper";
  if (engine === "openrouter") return "OpenRouter Whisper";
  return "Parakeet local";
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
    transcriptionEngine = "parakeet",
  } = input;
  const isolateVocals = loadClipperSettings().transcription.isolateVocals === "on";

  if (trimUnchanged && existingWords.length > 0) {
    return existingWords;
  }

  const diagRunId = createTranscriptionDiagRunId();
  logTranscriptionDiag("RUN_START", {
    runId: diagRunId,
    projectId: input.projectId,
    mediaFileId: session.mediaFileId,
    clipDuration,
    engine: transcriptionEngine,
  });

  try {
    const existing = await transcriptionService.getTranscription(
      session.mediaFileId,
      {
        clipStartSec: snappedStart,
        clipEndSec: end,
        engine: transcriptionEngine,
        isolateVocals,
      },
    );
    const words = buildWordCuesForTranscription(existing, clipDuration);
    clipperLog("transcribe: reused transcription", {
      wordCount: words.length,
      engine: transcriptionEngine,
    });
    logTranscriptionDiag("TRANSCRIBE_CACHE_HIT", {
      runId: diagRunId,
      wordCount: words.length,
      engine: transcriptionEngine,
    });
    return words;
  } catch {
    // Fall through to local ASR run.
  }

  const modelName = transcriptionModelLabel(transcriptionEngine);
  const isCloud = isCloudTranscriptionEngine(transcriptionEngine);
  reporter.stage("transcribing", `Transcribing speech (${modelName})…`);
  reporter.stageProgress(0);
  reporter.stageDetail("Preparing audio", 0);

  const rangeFile = session.rangeTrimmedFile ?? session.trimmedFile;
  const transcriptionSource = rangeFile ?? session.sourceFile;
  if (!(await hasTranscribableAudioTrack(transcriptionSource))) {
    session.audioEnvelope = null;
    clipperLog("transcribe: no audio track, skipping ASR", {
      fileName: transcriptionSource.name,
    });
    logTranscriptionDiag("TRANSCRIBE_SKIP", {
      runId: diagRunId,
      reason: "no_audio_track",
    });
    reporter.stageProgress(1);
    reporter.stageDetail(null, null);
    return [];
  }

  let transcriptionAudio: PreparedTranscriptionAudio;
  try {
    transcriptionAudio = await extractClipAudioForTranscription(
      rangeFile ?? session.sourceFile,
      rangeFile ? 0 : snappedStart,
      rangeFile ? clipDuration : end,
      {
        projectId: input.projectId,
        signal: options.signal,
        onProgress: (ratio) => {
          reporter.stageProgress(ratio * PREPARE_WEIGHT);
          reporter.stageDetail("Preparing audio", ratio);
        },
        diagRunId,
      },
    );
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (error instanceof NoTranscribableAudioError) {
      session.audioEnvelope = null;
      clipperLog("transcribe: no audio track, skipping ASR", {
        fileName: transcriptionSource.name,
      });
      logTranscriptionDiag("TRANSCRIBE_SKIP", {
        runId: diagRunId,
        reason: "no_audio_track",
      });
      reporter.stageProgress(1);
      reporter.stageDetail(null, null);
      return [];
    }
    session.audioEnvelope = null;
    clipperLog(
      "transcribe: audio extract failed",
      { error: String(error) },
    );
    logTranscriptionDiag("TRANSCRIBE_ERROR", {
      runId: diagRunId,
      step: "audio_extract",
      error: String(error),
    });
    throw error;
  }
  if (options.signal.aborted)
    throw new DOMException("Conversion aborted", "AbortError");

  if (!session.audioEnvelope) {
    session.audioEnvelope = transcriptionAudio.audioEnvelope;
    clipperLog("transcribe: RMS envelope ready", {
      hops: session.audioEnvelope.values.length,
    });
  }

  reporter.stageProgress(PREPARE_WEIGHT);
  if (isCloud) {
    reporter.stageDetail("Preparing cloud transcription", null);
    reporter.stage("transcribing", "Preparing cloud transcription…");
  } else {
    reporter.stageDetail("Loading speech model", null);
    reporter.stage("transcribing", "Loading speech model…");
  }

  const transcription = await transcriptionService.transcribe(
    transcriptionAudio.audioPath,
    session.mediaFileId,
    input.projectId,
    {
      signal: options.signal,
      clipStartSec: snappedStart,
      clipEndSec: end,
      engine: transcriptionEngine,
      isolateVocals,
      diagRunId,
      onProgress: (progress) => {
        if (progress.phase === "isolating_vocals") {
          const detailLabel =
            progress.ratio >= 0.995 ? "Writing vocals" : "Isolating vocals";
          const stageLabel =
            progress.ratio >= 0.995 ? "Writing vocals…" : "Isolating vocals…";
          reporter.stageProgress(
            PREPARE_WEIGHT + progress.ratio * (LOAD_END - PREPARE_WEIGHT) * 0.5,
          );
          reporter.stageDetail(detailLabel, progress.ratio);
          reporter.stage("transcribing", stageLabel);
          return;
        }
        if (progress.phase === "compressing_audio") {
          const chunkLabel =
            progress.chunkCount > 1
              ? `Compressing audio, chunk ${progress.chunkIndex + 1}/${progress.chunkCount}`
              : "Compressing audio";
          reporter.stageProgress(
            LOAD_END + progress.ratio * INFER_WEIGHT * 0.08,
          );
          reporter.stageDetail(chunkLabel, progress.ratio);
          reporter.stage("transcribing", "Compressing audio for cloud upload…");
          return;
        }
        if (progress.phase === "reading_audio") {
          reporter.stageProgress(LOAD_END + progress.ratio * INFER_WEIGHT * 0.05);
          reporter.stageDetail("Reading prepared audio", progress.ratio);
          reporter.stage("transcribing", "Preparing cloud upload…");
          return;
        }
        if (progress.phase === "uploading") {
          const chunkLabel =
            progress.chunkCount > 1
              ? `Uploading audio, chunk ${progress.chunkIndex + 1}/${progress.chunkCount}`
              : "Uploading audio";
          if (progress.ratio <= 0) {
            reporter.stageProgress(LOAD_END + INFER_WEIGHT * 0.08);
            reporter.stageDetail("Preparing cloud upload", null);
            reporter.stage("transcribing", "Preparing cloud upload…");
            return;
          }
          reporter.stageProgress(
            LOAD_END + INFER_WEIGHT * (0.08 + progress.ratio * 0.32),
          );
          reporter.stageDetail(chunkLabel, progress.ratio);
          reporter.stage("transcribing", "Uploading audio to cloud…");
          return;
        }
        if (progress.phase === "waiting") {
          const chunkLabel =
            progress.chunkCount > 1
              ? `Waiting for transcription, chunk ${progress.chunkIndex + 1}/${progress.chunkCount}`
              : "Waiting for transcription";
          reporter.stageProgress(
            LOAD_END + INFER_WEIGHT * (0.4 + progress.ratio * 0.6),
          );
          reporter.stageDetail(chunkLabel, progress.ratio);
          reporter.stage("transcribing", `Transcribing with ${modelName}…`);
          return;
        }
        const runtime =
          progress.provider === "directml"
            ? "GPU (DirectML)"
            : progress.provider === "cpu"
              ? "CPU fallback"
              : "speech model";
        if (progress.phase === "loading") {
          if (progress.ratio >= 1) {
            reporter.stageProgress(LOAD_END);
            reporter.stageDetail(`Transcribing with ${runtime}`, null);
            reporter.stage("transcribing", `Transcribing with ${runtime}…`);
          } else {
            reporter.stageProgress(PREPARE_WEIGHT);
            reporter.stageDetail(`Loading ${runtime}`, null);
            reporter.stage("transcribing", `Loading ${runtime}…`);
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
            ? `Transcribing with ${runtime}, chunk ${progress.chunkIndex + 1}/${progress.chunkCount}`
            : `Transcribing with ${runtime}`;
        reporter.stageDetail(chunkLabel, progress.ratio);
        reporter.stage(
          "transcribing",
          progress.chunkCount > 0
            ? `Transcribing (${runtime}, chunk ${progress.chunkIndex + 1}/${progress.chunkCount})…`
            : `Transcribing with ${runtime}…`,
        );
      },
    },
  );
  if (options.signal.aborted)
    throw new DOMException("Conversion aborted", "AbortError");

  reporter.stageProgress(1);
  reporter.stageDetail(null, null);
  const words = buildWordCuesForTranscription(transcription, clipDuration);
  logTranscriptionDiag("RUN_DONE", {
    runId: diagRunId,
    wordCount: words.length,
    engine: transcriptionEngine,
  });
  return words;
}
