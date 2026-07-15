import { useEffect } from "react";
import { isClipperStepCompleted } from "../persistence/pipeline-api";
import { clipperError, clipperLog } from "../shared/logger";
import { yieldToMain } from "../shared/yield-to-main";
import type { PipelineReporter } from "../pipeline/reporter";
import { buildLoadedResumeKey, planResumeExecution } from "../pipeline/resume";
import { createFaceCache, normalizeClipperSession, type ClipperSession } from "../pipeline/session";
import type { ClipperLoadedProject } from "./useClipperProjectLoader";
import type { ClipperPipelineState } from "../shared/state";

interface UseClipperResumeOptions {
  loaded: ClipperLoadedProject | null;
  projectId: string;
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>;
  setSettingsState: React.Dispatch<React.SetStateAction<import("../settings/settings").ClipperSettings>>;
  setRangeLocked: React.Dispatch<React.SetStateAction<boolean>>;
  metadataRef: React.MutableRefObject<import("../persistence/project-metadata").ClipperProjectMetadata>;
  sessionRef: React.MutableRefObject<ClipperSession | null>;
  abortRef: React.MutableRefObject<AbortController | null>;
  resumeStartedRef: React.MutableRefObject<boolean>;
  loadedResumeKeyRef: React.MutableRefObject<string | null>;
  reporter: PipelineReporter;
  initialState: ClipperPipelineState;
  activeClipIndexRef: React.MutableRefObject<number>;
  preparePreviewFromRange: (
    session: ClipperSession,
    snappedStart: number,
    end: number,
    words: import("../../lib/media/transcription-export").WordCue[],
    controller: AbortController,
    runId: string,
    options: {
      skipFaceDetect?: boolean;
      skipSubjectAnalysis?: boolean;
      skipTrim?: boolean;
      projectId: string;
      mediaFileId: string;
    },
  ) => Promise<void>;
  confirmRange: (start: number, end: number) => Promise<void>;
}

/** Handles project reload resume sequencing (StrictMode-safe). */
export function useClipperResume({
  loaded,
  projectId,
  setState,
  setSettingsState,
  setRangeLocked,
  metadataRef,
  sessionRef,
  abortRef,
  resumeStartedRef,
  loadedResumeKeyRef,
  reporter,
  initialState,
  activeClipIndexRef,
  preparePreviewFromRange,
  confirmRange,
}: UseClipperResumeOptions): void {
  useEffect(() => {
    if (!loaded) return;

    const resumeKey = buildLoadedResumeKey(loaded, projectId);
    const resumeKeyChanged = resumeKey !== loadedResumeKeyRef.current;
    if (resumeKeyChanged) {
      loadedResumeKeyRef.current = resumeKey;
      resumeStartedRef.current = false;
    }

    metadataRef.current = loaded.metadata;
    setSettingsState(loaded.settings);
    setRangeLocked(isClipperStepCompleted(loaded.steps, "confirm_range"));

    const plan = planResumeExecution(loaded, loaded.metadata, loaded.resumePlan, projectId);

    if (plan.kind === "idle") {
      if (!loaded.sourceFile) setState({ ...initialState, stage: "idle" });
      return;
    }

    if (plan.kind === "trimming") {
      setState({
        ...initialState,
        stage: "trimming",
        stageMessage: "Choose your source range",
        sourceFileName: plan.sourceFileName,
        sourceDuration: plan.sourceDuration,
        clipStart: plan.clipStart,
        clipEnd: plan.clipEnd,
      });
      return;
    }

    let session = sessionRef.current;
    if (!session || resumeKeyChanged) {
      session = {
        sourceFile: loaded.sourceFile!,
        sourceUrl: loaded.sourceUrl!,
        sourceDuration: loaded.sourceDuration!,
        mediaFileId: loaded.mediaFileId!,
        rangeTrimmedFile: null,
        rangeTrimmedVideoUrl: null,
        trimmedFile: null,
        trimmedVideoUrl: null,
        rangeWords: loaded.words,
        words: loaded.words,
        rangeStart: loaded.metadata.clipStart,
        rangeEnd: loaded.metadata.clipEnd ?? 0,
        clipStart: loaded.metadata.clipStart,
        clipEnd: loaded.metadata.clipEnd ?? 0,
        autoPartsClips: [],
        aiClips: [],
        clipSourceMode: loaded.metadata.clipSourceMode ?? "auto-parts",
        clips: [],
        activeClipIndex: loaded.metadata.activeClipIndex ?? 0,
        disabledCollageRegionIds: [],
        faceCache: null,
        captionGroupsCache: null,
        faceRenderCache: null,
      };
      sessionRef.current = session;
    }

    normalizeClipperSession(session);
    sessionRef.current = session;

    activeClipIndexRef.current = loaded.metadata.activeClipIndex ?? 0;

    clipperLog("pipeline[resume]: plan", { ...loaded.resumePlan });
    if (resumeStartedRef.current) return;

    resumeStartedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    session.faceCache = createFaceCache(session, reporter);

    setState({
      ...initialState,
      stage: "uploading",
      stageMessage: "Restoring trimmed video from project data…",
      sourceFileName: plan.sourceFileName,
      sourceDuration: plan.sourceDuration,
      clipStart: plan.clipStart,
      clipEnd: plan.clipEnd,
      activeClipIndex: loaded.metadata.activeClipIndex ?? 0,
      stageProgress: 0,
    });

    const shouldPreparePreview =
      plan.kind === "restore" && (plan.useFastPreviewRestore || plan.useWords);

    const resumePromise = shouldPreparePreview
      ? preparePreviewFromRange(
          session,
          plan.clipStart,
          plan.clipEnd,
          plan.words,
          controller,
          "resume",
          plan.previewOptions,
        )
      : confirmRange(plan.clipStart, plan.clipEnd);

    let finished = false;
    void (async () => {
      await yieldToMain();
      try {
        await resumePromise;
        finished = true;
      } catch (error) {
        finished = true;
        if (controller.signal.aborted) return;
        clipperError("pipeline[resume]: failed", error);
        setState((prev) => ({
          ...prev,
          stage: "error",
          stageMessage: "Could not restore your clip session",
          error: error instanceof Error ? error.message : "Could not restore preview.",
          sourceFileName: plan.sourceFileName,
          sourceDuration: plan.sourceDuration,
          clipStart: plan.clipStart,
          clipEnd: plan.clipEnd,
        }));
      }
    })();

    return () => {
      if (!finished) {
        abortRef.current?.abort();
        resumeStartedRef.current = false;
      }
    };
  }, [activeClipIndexRef, confirmRange, loaded, preparePreviewFromRange, projectId]);
}
