import { useCallback, useRef } from "react";

import type { Project } from "../../../../services/projects.service";
import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import {
  runConfirmRangeStep,
  runTranscribeRangePipeline,
} from "../../pipeline/range-workflow.util";
import { loadClipperSettings } from "../../settings/settings-storage.util";
import { clipperError } from "../../shared/logger.util";
import { preparePreviewFromRange } from "./clipper-pipeline-preview-range.util";
import { describeClipperError } from "./pipeline-error.util";
import { useClipperPipelineSessionActions } from "./use-clipper-pipeline-session-actions.hook";
import {
  clearActiveClipperSteps,
  markClipperStepFailed,
  type ClipperPipelineStepKey,
} from "../../persistence/pipeline-api.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineWorkflow(
  core: UseClipperPipelineCoreResult,
  project: Project,
  token: string | null,
) {
  const {
    projectId,
    setState,
    settings,
    refs,
    persistMetadata,
    hydrateExportsFromDisk,
    setRangeLocked,
    setDisabledCollageRegionIds,
    setAutoPartsSegmentLengthSec,
  } = core;
  const {
    abortRef,
    sessionRef,
    activeClipIndexRef,
    metadataRef,
    aiClipsMetaRef,
    reporterRef,
  } = refs;
  const wordsPerGroup = captionWordsPerGroup(settings.captions);

  const { selectFile, clipAgain, resetSessionForNewRange } = useClipperPipelineSessionActions(
    core,
    project,
    token,
    refs,
  );

  const previewDeps = {
    settings,
    metadataRef,
    aiClipsMetaRef,
    activeClipIndexRef,
    reporterRef,
    persistMetadata,
    setDisabledCollageRegionIds,
    setAutoPartsSegmentLengthSec,
    setState,
    hydrateExportsFromDisk,
  };

  // Read through a ref so the callback identity never changes. The resume effect keeps this
  // callback in its dependency array — a new identity there aborts the in-flight resume and
  // restarts it, which is how a long face analysis used to loop forever.
  const previewDepsRef = useRef(previewDeps);
  previewDepsRef.current = previewDeps;

  const preparePreviewFromRangeCallback = useCallback(
    async (
      session: Parameters<typeof preparePreviewFromRange>[1],
      snappedStart: number,
      end: number,
      words: Parameters<typeof preparePreviewFromRange>[4],
      controller: AbortController,
      runId: string,
      options: Parameters<typeof preparePreviewFromRange>[7],
    ) =>
      preparePreviewFromRange(
        previewDepsRef.current,
        session,
        snappedStart,
        end,
        words,
        controller,
        runId,
        options,
      ),
    [],
  );

  /** Records a failed phase and surfaces it, so reopening the project offers Retry
   *  instead of silently restarting a step that cannot succeed. */
  const failPhase = useCallback(
    async (stepKey: ClipperPipelineStepKey, error: unknown, runId: string) => {
      clipperError(`pipeline[${runId}]: failed`, error);
      const message = describeClipperError(error);
      await markClipperStepFailed(projectId, stepKey, message);
      await clearActiveClipperSteps(projectId);
      await persistMetadata({}, "error");
      setState((prev) => ({
        ...prev,
        stage: "error",
        error: message,
        rangeTrimmedVideoUrl: null,
        clipPreviews: [],
        autoPartsClipPreviews: [],
        aiClipPreviews: [],
      }));
    },
    [persistMetadata, projectId, setState],
  );

  const resumeFromTranscribe = useCallback(
    async (
      session: Parameters<typeof preparePreviewFromRange>[1],
      snappedStart: number,
      end: number,
      controller: AbortController,
      runId: string,
      previewOptions: Parameters<typeof preparePreviewFromRange>[7],
    ) => {
      let phase: ClipperPipelineStepKey = "transcribe";
      try {
        const words = await runTranscribeRangePipeline(
          session,
          {
            projectId,
            snappedStart,
            end,
            metadata: metadataRef.current,
            transcriptionEngine: loadClipperSettings().transcription.engine,
          },
          reporterRef.current,
          { signal: controller.signal },
        );
        setRangeLocked(true);
        phase = "analyze_faces";

        await persistMetadata(
          {
            clipStart: snappedStart,
            clipEnd: end,
            transcribedClipStart: snappedStart,
            transcribedClipEnd: end,
          },
          "analyzing-faces",
        );

        await preparePreviewFromRangeCallback(
          session,
          snappedStart,
          end,
          words,
          controller,
          runId,
          previewOptions,
        );
      } catch (error) {
        // Aborts leave steps to the owner of the abort: unmount cleanup demotes them, and a
        // restarted run re-marks them active. Demoting here would race that restart.
        if (controller.signal.aborted) return;
        await failPhase(phase, error, runId);
      }
    },
    [
      failPhase,
      metadataRef,
      persistMetadata,
      preparePreviewFromRangeCallback,
      projectId,
      reporterRef,
      setRangeLocked,
    ],
  );

  const confirmRange = useCallback(
    async (start: number, end: number) => {
      const session = sessionRef.current;
      if (!session) return;

      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      resetSessionForNewRange();

      setState((prev) => ({
        ...prev,
        stage: "uploading",
        stageMessage: "Preparing your clips…",
        renderProgress: {},
        exportHistory: prev.exportHistory,
        rangeTrimmedVideoUrl: null,
        clipPreviews: [],
        autoPartsClipPreviews: [],
        aiClipPreviews: [],
        rangeWords: [],
        activeClipIndex: 0,
        error: null,
        clipStart: start,
        clipEnd: end,
        hasDetectedFaces: null,
        hasTwoSpeakers: null,
        faceAnalysisProgress: null,
        analysisEtaSeconds: null,
        stageProgress: 0,
      }));

      let snappedStart: number;
      try {
        snappedStart = await runConfirmRangeStep(
          session,
          {
            projectId,
            start,
            end,
            persistRange: async (rangeStart, rangeEndInner) => {
              await persistMetadata(
                {
                  clipStart: rangeStart,
                  clipEnd: rangeEndInner,
                },
                "uploading",
              );
            },
          },
          reporterRef.current,
        );
      } catch (error) {
        // Aborts leave steps to the owner of the abort: unmount cleanup demotes them, and a
        // restarted run re-marks them active. Demoting here would race that restart.
        if (controller.signal.aborted) return;
        await failPhase("confirm_range", error, runId);
        return;
      }

      // Everything after the range is confirmed is the same work a resume performs.
      await resumeFromTranscribe(session, snappedStart, end, controller, runId, {
        projectId,
        mediaFileId: session.mediaFileId,
      });
    },
    [
      abortRef,
      failPhase,
      persistMetadata,
      projectId,
      reporterRef,
      resetSessionForNewRange,
      resumeFromTranscribe,
      sessionRef,
      setState,
    ],
  );

  return {
    preparePreviewFromRange: preparePreviewFromRangeCallback,
    confirmRange,
    resumeFromTranscribe,
    failPhase,
    selectFile,
    clipAgain,
  };
}
