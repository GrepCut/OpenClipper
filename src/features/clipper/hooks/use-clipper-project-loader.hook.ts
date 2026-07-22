import { useCallback, useEffect, useRef, useState } from "react";

import type { Project } from "../../../services/projects.service";
import { transcriptionService } from "../../../services/transcription.service";
import type { WordCue } from "../lib/media/transcription-export.util";
import { buildWordCuesForTranscription } from "../engine/transcript";
import {
  initClipperProjectSync,
  loadClipperSourceMediaFile,
} from "../persistence/bootstrap.util";
import { getClipperMetadataFromProject } from "../persistence/metadata-autosave.util";
import type { ClipperProjectMetadata } from "../persistence/project-metadata.util";
import { canRestoreTranscriptionFromMetadata } from "../persistence/project-metadata.util";
import {
  fetchClipperProjectSettings,
  fetchRenderQueueFormats,
} from "../persistence/clipper-db-api.util";
import { sanitizeRenderQueueSelections } from "../shared/render-queue-utils.util";
import type { ClipperSettings } from "../settings/settings.util";
import { clipperError, clipperLog } from "../shared/logger.util";
import {
  CLIPPER_SESSION_BOOT_STEPS,
  isRestoreBootFlow,
  markStepsThroughDone,
  markStepActive,
  simpleLoadingStatus,
  type ClipperLoadingStatus,
} from "../shared/loading-status.util";
import { yieldToMain } from "../shared/yield-to-main.util";
import {
  clipperPipelineService,
  type ClipperFaceAnalysisRecord,
  type ClipperPipelineStepRecord,
  type ClipperResumePlan,
} from "../persistence/pipeline-api.util";

export type ClipperLoaderPhase = "loading" | "ready" | "error";

export interface ClipperLoadedProject {
  metadata: ClipperProjectMetadata;
  settings: ClipperSettings;
  renderQueueFormats: Record<number, string[]>;
  sourceFile: File | null;
  sourceUrl: string | null;
  sourceDuration: number | null;
  sourceFileName: string | null;
  mediaFileId: string | null;
  words: WordCue[];
  steps: ClipperPipelineStepRecord[];
  resumePlan: ClipperResumePlan;
  faceAnalysis: ClipperFaceAnalysisRecord | null;
}

const INITIAL_LOADING_STATUS = simpleLoadingStatus("Opening clip project…");

export function useClipperProjectLoader(project: Project, token: string | null) {
  const [phase, setPhase] = useState<ClipperLoaderPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<ClipperLoadedProject | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState<ClipperLoadingStatus>(INITIAL_LOADING_STATUS);
  const loadGenerationRef = useRef(0);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (project.projectType !== "clipper") {
      setPhase("error");
      setError("This project is not a Clipper session.");
      return;
    }

    let cancelled = false;
    const generation = ++loadGenerationRef.current;

    const isStale = () => cancelled || generation !== loadGenerationRef.current;

    const load = async () => {
      setPhase("loading");
      setError(null);
      setLoadingStatus(INITIAL_LOADING_STATUS);

      let isRestoreFlow = false;

      const applyLoading = async (status: ClipperLoadingStatus): Promise<void> => {
        if (isStale()) return;
        setLoadingStatus(status);
        await yieldToMain();
      };

      const report = async (
        stepId: string,
        message: string,
        detail?: string,
      ): Promise<void> => {
        if (!isRestoreFlow) {
          await applyLoading(simpleLoadingStatus(message));
          return;
        }
        await applyLoading({
          message,
          detail,
          steps: markStepActive(CLIPPER_SESSION_BOOT_STEPS, stepId),
          phaseStartedAt: Date.now(),
        });
      };

      try {
        await applyLoading(simpleLoadingStatus("Reading project metadata"));
        const metadata = getClipperMetadataFromProject(project.metadata);
        isRestoreFlow = isRestoreBootFlow(null, metadata.stage);

        await report(
          "metadata",
          "Reading project metadata",
          "Parsing clipper settings and saved stage from the project record",
        );

        await report(
          "sync",
          "Initializing local project sync",
          "Resetting asset registry and connecting to the project synchronizer",
        );
        await initClipperProjectSync(project, token ?? "");

        await report(
          "pipeline",
          "Loading pipeline state",
          "Fetching completed steps and resume plan from the server",
        );
        const pipelineState = await clipperPipelineService.getPipeline(project.id);
        const { steps, resumePlan, faceAnalysis } = pipelineState;
        isRestoreFlow = isRestoreBootFlow(resumePlan, metadata.stage);

        await report(
          "settings",
          "Loading clipper settings",
          "Fetching project settings and render queue from the server",
        );
        const [settings, renderQueueFormats] = await Promise.all([
          fetchClipperProjectSettings(project.id),
          fetchRenderQueueFormats(project.id),
        ]);
        const sanitizedRenderQueue = sanitizeRenderQueueSelections(renderQueueFormats);

        if (!metadata.sourceMediaFileId) {
          if (!isStale()) {
            setLoadingStatus(
              isRestoreFlow
                ? {
                    message: "Project ready",
                    detail: "No source video attached yet",
                    steps: markStepsThroughDone(CLIPPER_SESSION_BOOT_STEPS, "finalize"),
                  }
                : simpleLoadingStatus("Project ready"),
            );
            setLoaded({
              metadata,
              settings,
              renderQueueFormats: sanitizedRenderQueue,
              sourceFile: null,
              sourceUrl: null,
              sourceDuration: null,
              sourceFileName: null,
              mediaFileId: null,
              words: [],
              steps,
              resumePlan,
              faceAnalysis,
            });
            setPhase("ready");
          }
          return;
        }

        await report(
          "source",
          "Locating source video",
          "Loading project sync state from server",
        );
        const source = await loadClipperSourceMediaFile(
          project,
          token ?? "",
          metadata.sourceMediaFileId,
          {
            onPhase: async (message, detail) => {
              if (isStale()) return;
              if (!isRestoreFlow) {
                await applyLoading(simpleLoadingStatus(message));
                return;
              }
              setLoadingStatus({
                message,
                detail,
                steps: markStepActive(CLIPPER_SESSION_BOOT_STEPS, "source"),
                phaseStartedAt: Date.now(),
              });
              await yieldToMain();
            },
          },
        );

        if (!source) {
          if (!isStale()) {
            setLoadingStatus(
              isRestoreFlow
                ? {
                    message: "Project ready",
                    detail: "Source video file could not be located on this device",
                    steps: markStepsThroughDone(CLIPPER_SESSION_BOOT_STEPS, "finalize"),
                  }
                : simpleLoadingStatus("Project ready"),
            );
            setLoaded({
              metadata: { ...metadata, sourceMediaFileId: null, stage: "idle" },
              settings,
              renderQueueFormats: sanitizedRenderQueue,
              sourceFile: null,
              sourceUrl: null,
              sourceDuration: null,
              sourceFileName: null,
              mediaFileId: null,
              words: [],
              steps,
              resumePlan,
              faceAnalysis,
            });
            setPhase("ready");
          }
          return;
        }

        let words: WordCue[] = [];
        const clipDuration =
          metadata.clipEnd != null ? metadata.clipEnd - metadata.clipStart : null;

        const shouldLoadWords =
          resumePlan.skipTranscribe ||
          (metadata.sourceMediaFileId &&
            clipDuration != null &&
            clipDuration > 0 &&
            canRestoreTranscriptionFromMetadata(metadata));

        if (shouldLoadWords && metadata.sourceMediaFileId && clipDuration != null && clipDuration > 0) {
          await report(
            "transcription",
            "Restoring transcription",
            "Downloading word-level transcript and building caption cues",
          );
          try {
            const transcription = await transcriptionService.getTranscription(
              metadata.sourceMediaFileId,
              {
                clipStartSec: metadata.transcribedClipStart ?? metadata.clipStart,
                clipEndSec: metadata.transcribedClipEnd ?? metadata.clipEnd ?? undefined,
                engine: metadata.transcriptionEngine,
              },
            );
            words = buildWordCuesForTranscription(transcription, clipDuration);
            await yieldToMain();
            clipperLog("loader: restored transcription", {
              wordCount: words.length,
              stage: metadata.stage,
              skipTranscribe: resumePlan.skipTranscribe,
            });
          } catch (error) {
            clipperError("loader: transcription restore failed", error, {
              stage: metadata.stage,
              clipStart: metadata.clipStart,
              clipEnd: metadata.clipEnd,
            });
            words = [];
          }
        } else {
          await report(
            "transcription",
            "Skipping transcription restore",
            "Transcript not needed for the current project stage",
          );
        }

        await report(
          "finalize",
          "Preparing workspace",
          resumePlan.target === "restoring"
            ? "Handing off to session restore pipeline"
            : "Almost ready",
        );

        if (!isStale()) {
          setLoaded({
            metadata,
            settings,
            renderQueueFormats: sanitizedRenderQueue,
            sourceFile: source.file,
            sourceUrl: source.sourceUrl,
            sourceDuration: source.mediaFile.duration ?? null,
            sourceFileName: source.mediaFile.name,
            mediaFileId: source.mediaFile.id,
            words,
            steps,
            resumePlan,
            faceAnalysis,
          });
          setPhase("ready");
        }
      } catch (err) {
        clipperError("loader: failed", err);
        if (!isStale()) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Failed to load Clipper project.");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [project, reloadToken, token]);

  return {
    phase,
    error,
    loaded,
    reload,
    loadingStatus,
  };
}
