import { useCallback } from "react";
import type { Project } from "../../../../services/projects.service";
import { isMediabunnyConvertSupported } from "../../lib/convert/mediabunny-convert.util";
import { saveClipperRangeWords } from "../../persistence/clipper-range-words-api.util";
import { clipperPipelineService } from "../../persistence/pipeline-api.util";
import { removeClipperProjectDataDir } from "../../persistence/project-data-files.util";
import { runIngestStage } from "../../pipeline/stages/ingest.util";
import { syncSessionActiveClips } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineSessionActions(
  core: Pick<
    UseClipperPipelineCoreResult,
    | "projectId"
    | "setState"
    | "persistMetadata"
    | "revokePreviewUrls"
    | "clearSession"
    | "setRangeLocked"
  >,
  project: Project,
  token: string | null,
  refs: UseClipperPipelineCoreResult["refs"],
) {
  const {
    projectId,
    setState,
    persistMetadata,
    revokePreviewUrls,
    clearSession,
    setRangeLocked,
  } = core;
  const { abortRef, sessionRef, activeClipIndexRef, resumeStartedRef, reporterRef } = refs;

  const selectFile = useCallback(
    async (file: File) => {
      if (!isMediabunnyConvertSupported()) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error:
            "Your browser does not support in-browser video encoding. Try the latest Chrome, Edge, or Opera.",
        }));
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      revokePreviewUrls();
      clearSession();

      try {
        const { session, mediaFileId, duration } = await runIngestStage(
          project,
          file,
          token ?? "",
          reporterRef.current,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;

        sessionRef.current = session;
        persistMetadata(
          {
            sourceMediaFileId: mediaFileId,
            clipStart: 0,
            clipEnd: null,
            transcribedClipStart: undefined,
            transcribedClipEnd: undefined,
            activeClipIndex: undefined,
          },
          "trimming",
        );

        setState((prev) => ({
          ...prev,
          stage: "trimming",
          stageMessage: "Choose your source range",
          sourceDuration: duration,
          sourceFileName: file.name,
          stageProgress: null,
          stageDetailLabel: null,
          stageDetailProgress: null,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        clipperError("pipeline: upload failed", error);
        clearSession();
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: error instanceof Error ? error.message : "Could not save this video to your project.",
        }));
      }
    },
    [
      abortRef,
      clearSession,
      persistMetadata,
      project,
      reporterRef,
      revokePreviewUrls,
      sessionRef,
      setState,
      token,
    ],
  );

  const clipAgain = useCallback(() => {
    if (!sessionRef.current) return;
    revokePreviewUrls();
    void clipperPipelineService.resetPipeline(projectId);
    void removeClipperProjectDataDir(projectId);
    void saveClipperRangeWords(projectId, []).catch((error) =>
      clipperError("pipeline: clear range words failed", error),
    );
    setRangeLocked(false);
    resumeStartedRef.current = false;
    activeClipIndexRef.current = 0;
    persistMetadata(
      {
        clipEnd: null,
        transcribedClipStart: undefined,
        transcribedClipEnd: undefined,
        activeClipIndex: undefined,
      },
      "trimming",
    );
    setState((prev) => ({
      ...prev,
      stage: "trimming",
      stageMessage: "Choose your source range",
      exportHistory: [],
      rangeTrimmedVideoUrl: null,
      clipPreviews: [],
      autoPartsClipPreviews: [],
      aiClipPreviews: [],
      rangeWords: [],
      activeClipIndex: 0,
      error: null,
      renderProgress: {},
    }));
  }, [
    activeClipIndexRef,
    persistMetadata,
    projectId,
    resumeStartedRef,
    revokePreviewUrls,
    sessionRef,
    setRangeLocked,
    setState,
  ]);

  const resetSessionForNewRange = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    revokePreviewUrls();
    if (session.rangeTrimmedVideoUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(session.rangeTrimmedVideoUrl);
    }
    session.rangeTrimmedFile = null;
    session.rangeTrimmedVideoUrl = null;
    session.trimmedFile = null;
    session.trimmedVideoUrl = null;
    session.autoPartsClips = [];
    session.aiClips = [];
    session.rangeWords = [];
    session.words = [];
    syncSessionActiveClips(session);
    void saveClipperRangeWords(projectId, []).catch((error) =>
      clipperError("pipeline: clear range words on new range failed", error),
    );
  }, [projectId, revokePreviewUrls, sessionRef]);

  return { selectFile, clipAgain, resetSessionForNewRange };
}
