import { segmentRangeFromTrimmedFile } from "../engine/segmentation";
import { clipperLog, clipperTimer } from "../shared/logger.util";
import { snapToKeyframe } from "../platform/native-source.util";
import { markClipperStepCompleted } from "../persistence/pipeline-api.util";
import type { ClipperProjectMetadata } from "../persistence/project-metadata.util";
import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperGeneratedClip } from "../engine/segmentation";
import type { PipelineReporter } from "./reporter.util";
import { createFaceCache, syncSessionActiveClips, type ClipperSession } from "./session.util";
import { transcriptionService } from "../../../services/transcription.service";
import { runAnalyzeFacesStage } from "./stages/analyze-faces.util";
import { runAnalyzeSubjectsStage } from "./stages/analyze-subjects.util";
import { runTranscribeStage } from "./stages/transcribe.util";
import { runTrimStage, trimNativeSourceEarly } from "./stages/trim.util";
import type { LocalTranscriptionEngine } from "../../../services/transcription.service";

export interface PreparePreviewInput {
  projectId: string;
  mediaFileId: string;
  snappedStart: number;
  end: number;
  words: WordCue[];
  wordsPerGroup: number;
  targetLengthSec?: number;
  skipFaceDetect?: boolean;
  skipSubjectAnalysis?: boolean;
  skipTrim?: boolean;
  runId: string;
}

export interface PreparePreviewResult {
  rangeTrimmedVideoUrl: string;
  clips: ClipperGeneratedClip[];
  rangeDuration: number;
}

function syncRangeTrimAliases(session: ClipperSession): void {
  session.trimmedFile = session.rangeTrimmedFile;
  session.trimmedVideoUrl = session.rangeTrimmedVideoUrl;
}

/** Trims the full range, segments into clips, analyzes faces, and returns preview payload. */
export async function runPreparePreviewPipeline(
  session: ClipperSession,
  input: PreparePreviewInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<PreparePreviewResult> {
  const endRun = clipperTimer(`pipeline[${input.runId}]: resume full-pipeline`);
  clipperLog(`pipeline[${input.runId}]: resume full-pipeline — started`);

  const { trimmedFile, trimmedVideoUrl } = await runTrimStage(
    session,
    {
      projectId: input.projectId,
      snappedStart: input.snappedStart,
      end: input.end,
      skipTrim: input.skipTrim ?? false,
    },
    reporter,
    options,
  );
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  const rangeDuration = input.end - input.snappedStart;
  reporter.stage("uploading", "Scanning video keyframes for clip boundaries…");
  const clips = await segmentRangeFromTrimmedFile(
    trimmedFile,
    rangeDuration,
    input.words,
    input.wordsPerGroup,
    {
      signal: options.signal,
      targetLengthSec: input.targetLengthSec,
      onKeyframes: (keyframes) => {
        session.keyframeTimestamps = keyframes;
      },
    },
  );

  session.rangeTrimmedFile = trimmedFile;
  session.rangeTrimmedVideoUrl = trimmedVideoUrl;
  syncRangeTrimAliases(session);
  session.rangeWords = input.words;
  session.words = input.words;
  session.rangeStart = input.snappedStart;
  session.rangeEnd = input.end;
  session.clipStart = input.snappedStart;
  session.clipEnd = input.end;
  session.autoPartsClips = clips;
  session.aiClips = session.aiClips ?? [];
  session.clipSourceMode = session.clipSourceMode ?? "auto-parts";
  syncSessionActiveClips(session);
  session.activeClipIndex = 0;
  session.captionGroupsCache = null;

  await runAnalyzeFacesStage(
    session,
    {
      projectId: input.projectId,
      mediaFileId: input.mediaFileId,
      snappedStart: 0,
      end: rangeDuration,
      skipFaceDetect: input.skipFaceDetect ?? false,
      skipSubjectAnalysis: input.skipSubjectAnalysis ?? false,
      runId: input.runId,
    },
    reporter,
    options,
  );
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  await runAnalyzeSubjectsStage(session, {
    projectId: input.projectId,
    clipStart: 0,
    clipEnd: rangeDuration,
    skipSubjectAnalysis: input.skipSubjectAnalysis ?? false,
  }, reporter, options);
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  endRun();
  return { rangeTrimmedVideoUrl: trimmedVideoUrl, clips, rangeDuration };
}

export interface ConfirmRangeInput {
  projectId: string;
  start: number;
  end: number;
  wordsPerGroup: number;
  metadata: ClipperProjectMetadata;
  transcriptionEngine?: LocalTranscriptionEngine;
  isolateVocals?: boolean;
}

export interface ConfirmRangeResult {
  snappedStart: number;
  end: number;
  words: WordCue[];
}

/** Snaps, optionally pre-trims native source, transcribes, and prepares session for preview stage. */
export async function runConfirmRangePipeline(
  session: ClipperSession,
  input: ConfirmRangeInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<ConfirmRangeResult> {
  session.faceCache = createFaceCache(session, reporter);

  const snappedStart = await snapToKeyframe(session.sourceFile, input.start);
  reporter.stageProgress(0.1);
  const end = input.end;
  const clipDuration = end - snappedStart;
  if (session.rangeStart !== snappedStart || session.rangeEnd !== end) {
    session.audioEnvelope = null;
    session.rangeTrimmedFile = null;
    session.trimmedFile = null;
  }

  await markClipperStepCompleted(input.projectId, "confirm_range");
  await trimNativeSourceEarly(session, input.projectId, snappedStart, end, reporter, options);

  const trimUnchanged =
    input.metadata.transcribedClipStart === snappedStart &&
    input.metadata.transcribedClipEnd === end;

  const words = await runTranscribeStage(
    session,
    {
      projectId: input.projectId,
      snappedStart,
      end,
      clipDuration,
      trimUnchanged,
      existingWords: session.rangeWords.length > 0 ? session.rangeWords : session.words,
      transcriptionEngine: input.transcriptionEngine,
      isolateVocals: input.isolateVocals,
    },
    reporter,
    options,
  );
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  session.rangeWords = words;
  session.words = words;

  if (words.length > 0) {
    await markClipperStepCompleted(input.projectId, "transcribe", { wordCount: words.length });
  }

  return { snappedStart, end, words };
}
