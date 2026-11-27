import { useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { projectStateService } from "../../../../services/project-state.service";
import type { Project } from "../../../../services/projects.service";
import { isMediabunnyConvertSupported } from "../../lib/convert/mediabunny-convert.util";
import { cacheClipperSourceVideo } from "../../persistence/bootstrap.util";
import { saveClipperRangeWords } from "../../persistence/clipper-range-words-api.util";
import { scheduleClipperProjectMetadataSaveImmediate } from "../../persistence/metadata-autosave.util";
import type { ClipperProjectMetadata } from "../../persistence/project-metadata.util";
import { releasePlayableMediaUrl } from "../../persistence/tauri-media.util";
import { runIngestStage } from "../../pipeline/stages/ingest.util";
import type { ClipperSession } from "../../pipeline/session.util";
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
  const {
    abortRef, sessionRef, reporterRef, metadataRef,
    aiClipsMetaRef, manualClipsMetaRef,
  } = refs;
  const ingestInFlight = useRef(false);

  const selectFile = useCallback(
    async (file: File, importSignal?: AbortSignal) => {
      if (ingestInFlight.current) {
        if (importSignal) throw new Error("A video is already being opened.");
        return;
      }
      if (!isMediabunnyConvertSupported()) {
        if (importSignal) throw new Error("Could not open the downloaded video for editing.");
        setState((prev) => ({
          ...prev,
          stage: "error",
          error:
            "Your browser does not support in-browser video encoding. Try the latest Chrome, Edge, or Opera.",
        }));
        return;
      }

      importSignal?.throwIfAborted();
      ingestInFlight.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      revokePreviewUrls();
      clearSession();
      const cancelImport = () => controller.abort(importSignal?.reason);
      importSignal?.addEventListener("abort", cancelImport, { once: true });
      if (importSignal?.aborted) cancelImport();
      const mediaFileId = uuidv4();
      let registrationStarted = false;
      let sourceUrl: string | undefined;
      let pendingMetadata: ClipperProjectMetadata | undefined;
      const previousMetadata = metadataRef.current;

      try {
        controller.signal.throwIfAborted();
        const { session, mediaFile } = await runIngestStage(
          project,
          file,
          token ?? "",
          importSignal ? undefined : reporterRef.current,
          {
            mediaFileId,
            signal: controller.signal,
            onRegister: () => { registrationStarted = true; },
          },
        );
        sourceUrl = session.sourceUrl;
        controller.signal.throwIfAborted();

        const save = persistMetadata(
          {
            sourceMediaFileId: mediaFileId,
            skipAutoReframing: false,
            detectActiveSpeaker: false,
            clipStart: 0,
            clipEnd: null,
            transcribedClipStart: undefined,
            transcribedClipEnd: undefined,
            activeClipIndex: undefined,
          },
          "trimming",
        );
        pendingMetadata = metadataRef.current;
        await save;
        controller.signal.throwIfAborted();

        cacheClipperSourceVideo(mediaFile, file);
        sessionRef.current = session;
        setRangeLocked(false);
        setState((prev) => ({
          ...prev,
          stage: "trimming",
          stageMessage: "Choose your source range",
          sourceDuration: mediaFile.duration,
          sourceFileName: file.name,
          stageProgress: null,
          stageDetailLabel: null,
          stageDetailProgress: null,
        }));
      } catch (error) {
        releasePlayableMediaUrl(sourceUrl);
        if (pendingMetadata === metadataRef.current) {
          metadataRef.current = previousMetadata;
          await scheduleClipperProjectMetadataSaveImmediate(projectId, previousMetadata).catch((rollbackError) =>
            clipperError("pipeline: source metadata rollback failed", rollbackError),
          );
        }
        if (registrationStarted) {
          await projectStateService.patchState(projectId, {
            mediaFiles: { remove: [mediaFileId] },
          }).catch((rollbackError) => clipperError("pipeline: source registration rollback failed", rollbackError));
        }
        if (importSignal) {
          controller.signal.throwIfAborted();
          throw new Error("Could not open the downloaded video for editing.", { cause: error });
        }
        if (controller.signal.aborted) return;
        clipperError("pipeline: upload failed", error);
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: error instanceof Error ? error.message : "Could not save this video to your project.",
        }));
      } finally {
        ingestInFlight.current = false;
        importSignal?.removeEventListener("abort", cancelImport);
      }
    },
    [
      abortRef,
      clearSession,
      persistMetadata,
      project,
      projectId,
      metadataRef,
      reporterRef,
      revokePreviewUrls,
      sessionRef,
      setRangeLocked,
      setState,
      token,
    ],
  );

  const clearRangeSession = useCallback((session: ClipperSession) => {
    revokePreviewUrls();
    if (session.rangeTrimmedVideoUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(session.rangeTrimmedVideoUrl);
    }
    Object.assign(session, {
      rangeTrimmedFile: null,
      rangeTrimmedVideoUrl: null,
      autoPartsClips: [],
      aiClips: [],
      manualClips: [],
      clips: [],
      activeClipIndex: 0,
      rangeWords: [],
      words: [],
      audioEnvelope: null,
      rangeStart: 0,
      rangeEnd: 0,
      clipStart: 0,
      clipEnd: 0,
      faceCache: null,
      collageFaceSamples: null,
      smartCropAnalysis: null,
      pendingSubjectExtraction: null,
      faceActionBenchmark: null,
      keyframeTimestamps: undefined,
      captionGroupsCache: null,
      faceRenderCache: null,
    } satisfies Partial<ClipperSession>);
    aiClipsMetaRef.current = [];
    manualClipsMetaRef.current = [];
  }, [aiClipsMetaRef, manualClipsMetaRef, revokePreviewUrls]);

  const resetSessionForNewRange = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    clearRangeSession(session);
    void saveClipperRangeWords(projectId, []).catch((error) =>
      clipperError("pipeline: clear range words on new range failed", error),
    );
  }, [clearRangeSession, projectId, sessionRef]);

  return { selectFile, resetSessionForNewRange };
}
