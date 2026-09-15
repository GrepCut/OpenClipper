import { useEffect } from "react";
import { deriveRangeLocked } from "./clipper-pipeline/clipper-pipeline-context";
import type {
  ClipperPipelineStepKey,
  ClipperResumeStageKey,
} from "../persistence/pipeline-api.util";
import { clipperLog } from "../shared/logger.util";
import { yieldToMain } from "../shared/yield-to-main.util";
import type { PipelineReporter } from "../pipeline/reporter.util";
import {
  buildLoadedResumeKey,
  planResumeExecution,
  resumePlanStateFields,
  RESUME_ERROR_MESSAGE,
  type ResumePreviewOptions,
} from "../pipeline/resume.util";
import { createFaceCache, normalizeClipperSession, type ClipperSession } from "../pipeline/session.util";
import type { ClipperLoadedProject } from "./use-clipper-project-loader.hook";
import type { ClipperPipelineState } from "../shared/state.util";

interface UseClipperResumeOptions {
  loaded: ClipperLoadedProject | null;
  projectId: string;
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>;
  setSettingsState: React.Dispatch<React.SetStateAction<import("../settings/settings.util").ClipperSettings>>;
  setRangeLocked: React.Dispatch<React.SetStateAction<boolean>>;
  metadataRef: React.MutableRefObject<import("../persistence/project-metadata.util").ClipperProjectMetadata>;
  sessionRef: React.MutableRefObject<ClipperSession | null>;
  abortRef: React.MutableRefObject<AbortController | null>;
  resumeStartedRef: React.MutableRefObject<boolean>;
  loadedResumeKeyRef: React.MutableRefObject<string | null>;
  reporter: PipelineReporter;
  initialState: ClipperPipelineState;
  activeClipIndexRef: React.MutableRefObject<number>;
  /** Bumped by an explicit retry; also tells the planner to ignore a persisted error stage. */
  retryToken: number;
  preparePreviewFromRange: (
    session: ClipperSession,
    snappedStart: number,
    end: number,
    words: import("../lib/media/transcription-export.util").WordCue[],
    controller: AbortController,
    runId: string,
    options: ResumePreviewOptions,
  ) => Promise<void>;
  resumeFromTranscribe: (
    session: ClipperSession,
    snappedStart: number,
    end: number,
    controller: AbortController,
    runId: string,
    options: ResumePreviewOptions,
  ) => Promise<void>;
  /** Records the failed phase and paints the error panel — the only path that makes the
   *  "Resume this step" button appear, and the only one that survives a reopen. */
  failPhase: (stepKey: ClipperPipelineStepKey, error: unknown, runId: string) => Promise<void>;
}

/** Resume phases map 1:1 onto step keys except `preview`, whose step is `preview_ready`. */
function stepKeyForResumeStage(stage: ClipperResumeStageKey): ClipperPipelineStepKey {
  return stage === "preview" ? "preview_ready" : stage;
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
  retryToken,
  preparePreviewFromRange,
  resumeFromTranscribe,
  failPhase,
}: UseClipperResumeOptions): void {
  useEffect(() => {
    if (!loaded) return;

    const resumeKey = buildLoadedResumeKey(loaded, projectId);
    const resumeKeyChanged = resumeKey !== loadedResumeKeyRef.current;
    if (resumeKeyChanged) {
      loadedResumeKeyRef.current = resumeKey;
      resumeStartedRef.current = false;
      setSettingsState(loaded.settings);
      setRangeLocked(deriveRangeLocked(loaded));
      metadataRef.current = loaded.metadata;
    }

    const plan = planResumeExecution(loaded, metadataRef.current, loaded.resumePlan, projectId);

    if (plan.kind === "idle") {
      if (!loaded.sourceFile) setState({ ...initialState, stage: "idle" });
      return;
    }

    if (plan.kind === "trimming") {
      setState({ ...initialState, ...resumePlanStateFields(plan) });
      return;
    }

    if (plan.kind === "error") {
      clipperLog("pipeline[resume]: halted on persisted error", {
        resumeStage: plan.resumeStage,
      });
      setState((prev) => ({
        ...prev,
        ...resumePlanStateFields(plan),
        error: prev.error ?? RESUME_ERROR_MESSAGE,
      }));
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
        rangeWords: loaded.words,
        words: loaded.words,
        rangeStart: plan.clipStart,
        rangeEnd: plan.clipEnd,
        clipStart: plan.clipStart,
        clipEnd: plan.clipEnd,
        autoPartsClips: [],
        aiClips: [],
        manualClips: [],
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

    clipperLog("pipeline[resume]: plan", {
      ...loaded.resumePlan,
      resumeStage: plan.resumeStage,
    });
    if (resumeStartedRef.current) return;

    resumeStartedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    session.faceCache = createFaceCache(session, reporter);

    setState({
      ...initialState,
      ...resumePlanStateFields(plan),
      clipSourceMode: loaded.metadata.clipSourceMode ?? "auto-parts",
      activeClipIndex: loaded.metadata.activeClipIndex ?? 0,
      stageProgress: 0,
    });

    const resumePromise = plan.needsTranscribe
      ? resumeFromTranscribe(
          session,
          plan.clipStart,
          plan.clipEnd,
          controller,
          "resume",
          plan.previewOptions,
        )
      : preparePreviewFromRange(
          session,
          plan.clipStart,
          plan.clipEnd,
          plan.words,
          controller,
          "resume",
          plan.previewOptions,
        );

    let finished = false;
    void (async () => {
      await yieldToMain();
      try {
        await resumePromise;
      } catch (error) {
        if (!controller.signal.aborted) {
          await failPhase(stepKeyForResumeStage(plan.resumeStage), error, "resume");
        }
      } finally {
        finished = true;
      }
    })();

    return () => {
      if (!finished) abortRef.current?.abort();
      if (!finished || controller.signal.aborted) {
        resumeStartedRef.current = false;
      }
    };
  }, [
    activeClipIndexRef,
    failPhase,
    loaded,
    preparePreviewFromRange,
    projectId,
    resumeFromTranscribe,
    retryToken,
  ]);
}
