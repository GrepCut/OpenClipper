import { rebuildClipsFromGeneratedMetadata } from "../engine/segmentation";
import type { ClipperClipPayload } from "../persistence/clipper-clips-api";
import { clipperLog, clipperMeasureSync, clipperTimer } from "../shared/logger";
import type { PipelineReporter } from "./reporter";
import type { PreparePreviewInput, PreparePreviewResult } from "./range-workflow";
import type { ClipperSession } from "./session";
import { syncSessionActiveClips } from "./session";
import { runAnalyzeFacesStage } from "./stages/analyze-faces";
import { runAnalyzeSubjectsStage } from "./stages/analyze-subjects";
import { runTrimStage } from "./stages/trim";
function syncRangeTrimAliases(session: ClipperSession): void {
  session.trimmedFile = session.rangeTrimmedFile;
  session.trimmedVideoUrl = session.rangeTrimmedVideoUrl;
}

/** True when persisted clip boundaries can replace a mediabunny keyframe scan on reopen. */
export function canUseFastPreviewResume(
  clips: ClipperClipPayload[],
  skipToPreview: boolean,
  snappedStart: number,
  end: number,
): boolean {
  if (!skipToPreview) return false;

  if (!clips || clips.length === 0) return false;

  const rangeDuration = end - snappedStart;
  if (rangeDuration <= 0) return false;

  const sorted = [...clips].sort((a, b) => a.startSec - b.startSec);
  if (sorted[0].startSec > 0.05) return false;

  const lastEnd = sorted[sorted.length - 1].endSec;
  if (Math.abs(lastEnd - rangeDuration) > 0.1) return false;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].startSec - sorted[i - 1].endSec) > 0.05) return false;
  }

  return true;
}

export interface FastPreviewResumeInput extends PreparePreviewInput {
  generatedClips: Array<{ index: number; startSec: number; endSec: number }>;
}

/** Restores preview from disk trim + persisted clip boundaries — skips keyframe scan. */
export async function runFastPreviewResume(
  session: ClipperSession,
  input: FastPreviewResumeInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<PreparePreviewResult> {
  const endRun = clipperTimer(`pipeline[${input.runId}]: resume fast-path`);

  const { trimmedFile, trimmedVideoUrl } = await runTrimStage(
    session,
    {
      projectId: input.projectId,
      snappedStart: input.snappedStart,
      end: input.end,
      skipTrim: input.skipTrim ?? true,
    },
    reporter,
    options,
  );
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  const rangeDuration = input.end - input.snappedStart;
  reporter.stage("uploading", "Rebuilding clips from saved boundaries…");
  const clips = clipperMeasureSync(
    `pipeline[${input.runId}]: resume clip-rebuild`,
    () =>
      rebuildClipsFromGeneratedMetadata(
        input.generatedClips,
        input.words,
        input.wordsPerGroup,
      ),
    (result) => ({ clipCount: result.length }),
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
      skipFaceDetect: input.skipFaceDetect ?? true,
      skipSubjectAnalysis: input.skipSubjectAnalysis ?? true,
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
    skipSubjectAnalysis: input.skipSubjectAnalysis ?? true,
  }, reporter, options);
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  clipperLog(`pipeline[${input.runId}]: resume fast-path complete`, {
    clipCount: clips.length,
    rangeDuration,
  });
  endRun();

  return { rangeTrimmedVideoUrl: trimmedVideoUrl, clips, rangeDuration };
}
