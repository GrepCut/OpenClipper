import { useCallback } from "react";

import type { Project } from "../../../../services/projects.service";
import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import { runConfirmRangePipeline } from "../../pipeline/range-workflow.util";
import { loadClipperSettings } from "../../settings/settings-storage.util";
import { clipperError } from "../../shared/logger.util";
import { preparePreviewFromRange } from "./clipper-pipeline-preview-range.util";
import { describeClipperError } from "./pipeline-error.util";
import { useClipperPipelineSessionActions } from "./use-clipper-pipeline-session-actions.hook";
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

  const preparePreviewFromRangeCallback = useCallback(
    async (
      session: Parameters<typeof preparePreviewFromRange>[1],
      snappedStart: number,
      end: number,
      words: Parameters<typeof preparePreviewFromRange>[4],
      controller: AbortController,
      runId: string,
      options: Parameters<typeof preparePreviewFromRange>[7],
    ) => preparePreviewFromRange(previewDeps, session, snappedStart, end, words, controller, runId, options),
    [
      activeClipIndexRef,
      aiClipsMetaRef,
      hydrateExportsFromDisk,
      metadataRef,
      persistMetadata,
      reporterRef,
      setAutoPartsSegmentLengthSec,
      setDisabledCollageRegionIds,
      setState,
      wordsPerGroup,
      settings.formats.enabledFormatIds,
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

      try {
        const { snappedStart, end: rangeEnd, words } = await runConfirmRangePipeline(
          session,
          {
            projectId,
            start,
            end,
            wordsPerGroup,
            metadata: metadataRef.current,
            // Device-level model choice — read at invoke so Settings changes apply to open projects.
            transcriptionEngine: loadClipperSettings().transcription.engine,
          },
          reporterRef.current,
          { signal: controller.signal },
        );
        setRangeLocked(true);

        persistMetadata(
          {
            clipStart: snappedStart,
            clipEnd: rangeEnd,
            transcribedClipStart: snappedStart,
            transcribedClipEnd: rangeEnd,
          },
          "analyzing-faces",
        );

        await preparePreviewFromRangeCallback(session, snappedStart, rangeEnd, words, controller, runId, {
          projectId,
          mediaFileId: session.mediaFileId,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        clipperError(`pipeline[${runId}]: failed`, error);
        persistMetadata({}, "error");
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: describeClipperError(error),
          rangeTrimmedVideoUrl: null,
          clipPreviews: [],
          autoPartsClipPreviews: [],
          aiClipPreviews: [],
        }));
      }
    },
    [
      abortRef,
      metadataRef,
      persistMetadata,
      preparePreviewFromRangeCallback,
      projectId,
      reporterRef,
      resetSessionForNewRange,
      sessionRef,
      setRangeLocked,
      setState,
      wordsPerGroup,
    ],
  );

  return {
    preparePreviewFromRange: preparePreviewFromRangeCallback,
    confirmRange,
    selectFile,
    clipAgain,
  };
}
