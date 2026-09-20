import { useCallback, useMemo, useRef } from "react";

import { CLIPPER_FORMAT_DEFS } from "../../shared/formats.util";
import { baseName } from "../../shared/filename-template.util";
import { clipperError } from "../../shared/logger.util";
import {
  existingFormatIds,
  findExistingExports,
  type ExistingExportsByClip,
} from "../../shared/existing-exports.util";
import { renderProgressKey } from "../../shared/render-progress.util";
import {
  applyRenderBatchStartState,
  applyRenderFailureState,
  applyRenderStopState,
  applySuccessfulClipResults,
  buildInitialRenderProgress,
  remainingFormatIds,
  withoutStaleRenderProgress,
  type RenderBatchOutcome,
  type RenderExportsOptions,
} from "../../shared/render-batch.util";
import { buildFrameContext } from "../../pipeline/frame-context.util";
import { computeClipRenderSignature } from "../../pipeline/render-signature.util";
import { getActiveClips, syncSessionActiveClips } from "../../pipeline/session.util";
import { runRenderClipJob } from "../../pipeline/stages/render.util";
import { patchPipelineState } from "./clipper-pipeline-state.util";
import { createRenderBatchReporter, type RenderBatchReporter } from "./render-batch-reporter.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineRender(core: UseClipperPipelineCoreResult) {
  const {
    projectId,
    state,
    setState,
    settings,
    refs,
    persistMetadata,
    persistedExportCount,
    hydrateExportsFromDisk,
  } = core;
  const { abortRef, previewUrlsRef, sessionRef, reporterRef } = refs;

  /**
   * Formats already exported from the clips' current render inputs. Session fields read
   * through the ref (collage overrides, layout analysis) change together with the stage,
   * face revision and collage state listed as dependencies.
   */
  const existingExports = useMemo<ExistingExportsByClip>(() => {
    const session = sessionRef.current;
    if (!session || state.exportHistory.length === 0) return {};
    const clips = state.clipPreviews.map((preview) => preview.clip);
    const signatures: Record<number, string> = {};
    for (const clip of clips) {
      signatures[clip.index] = computeClipRenderSignature(session, settings, clip);
    }
    return findExistingExports(clips, signatures, state.exportHistory);
  }, [
    core.disabledCollageRegionIds,
    sessionRef,
    settings,
    state.clipPreviews,
    state.exportHistory,
    state.faceSampleRevision,
    state.stage,
  ]);
  /** Render batch still running (null once its loop has settled). */
  const activeBatchRef = useRef<{ controller: AbortController; progress: RenderBatchReporter } | null>(
    null,
  );

  const stopRender = useCallback(() => {
    const batch = activeBatchRef.current;
    if (!batch) {
      // Nothing running (e.g. stale statuses): just settle the UI.
      patchPipelineState(setState, applyRenderStopState);
      return;
    }
    if (batch.controller.signal.aborted) return;
    batch.progress.resetInFlightProgress();
    batch.controller.abort();
    // The batch loop applies the stop state once in-flight exports have settled, so their
    // results are kept and Continue cannot start while an old job is still writing files.
    patchPipelineState(setState, (draft) => {
      draft.stageMessage = "Stopping…";
    });
  }, [setState]);

  const renderExports = useCallback(
    async (
      perClipFormatIds?: Record<number, string[]>,
      options?: RenderExportsOptions,
    ): Promise<RenderBatchOutcome> => {
      const skipCompleted = options?.skipCompleted === true;
      const skipExisting = options?.skipExisting === true;
      const session = sessionRef.current;
      if (!session?.rangeTrimmedFile) {
        patchPipelineState(setState, (draft) => {
          draft.error = "Source video is not ready. Return to preview and try again.";
        });
        return "failed";
      }

      syncSessionActiveClips(session);
      const activeClips = getActiveClips(session);
      if (activeClips.length === 0) {
        patchPipelineState(setState, (draft) => {
          draft.error = "No clips are available to render.";
        });
        return "failed";
      }

      const selectedByClip: Record<number, string[]> = {};
      const clipSignatures: Record<number, string> = {};
      for (const clip of activeClips) {
        const requested = perClipFormatIds?.[clip.index] ?? settings.formats.enabledFormatIds;
        selectedByClip[clip.index] = CLIPPER_FORMAT_DEFS.filter((format) =>
          requested.includes(format.id),
        ).map((format) => format.id);
        clipSignatures[clip.index] = computeClipRenderSignature(session, settings, clip);
      }
      const completedProgress = skipCompleted
        ? withoutStaleRenderProgress(state.renderProgress, state.renderSignatures, clipSignatures)
        : {};
      if (skipExisting) {
        const existing = findExistingExports(activeClips, clipSignatures, state.exportHistory);
        for (const clip of activeClips) {
          for (const formatId of existingFormatIds(existing, clip.index)) {
            if (selectedByClip[clip.index]?.includes(formatId)) {
              completedProgress[renderProgressKey(clip.index, formatId)] = 1;
            }
          }
        }
      }
      const pendingByClip = remainingFormatIds(selectedByClip, completedProgress);

      const clipsToRender = activeClips.filter((clip) => pendingByClip[clip.index] !== undefined);
      if (clipsToRender.length === 0) {
        if (skipCompleted || skipExisting) {
          persistMetadata({}, "done");
          patchPipelineState(setState, (draft) => {
            draft.stage = "done";
            draft.stageMessage = "Your clips are ready!";
            draft.error = null;
          });
          return "completed";
        }
        patchPipelineState(setState, (draft) => {
          draft.error = "Select at least one export format.";
        });
        return "failed";
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const progress = createRenderBatchReporter(reporterRef.current, controller.signal);
      const activeBatch = { controller, progress };
      activeBatchRef.current = activeBatch;

      const initialProgress = buildInitialRenderProgress(selectedByClip, completedProgress);
      const stem = baseName(state.sourceFileName ?? "clip");
      const filenameTemplate = settings.formats.filenameTemplate;

      persistMetadata({}, "preview");
      patchPipelineState(setState, (draft) => {
        applyRenderBatchStartState(draft, {
          clipCount: clipsToRender.length,
          initialProgress,
          skipCompleted,
          selectedByClip,
        });
      });

      /** False once another pipeline flow (new file, reset, new batch) took over the state. */
      const ownsState = () => abortRef.current === controller;
      const applyAbort = () => {
        if (ownsState()) patchPipelineState(setState, applyRenderStopState);
      };

      let failedClipIndex: number | null = null;

      try {
        for (const [queuePosition, clip] of clipsToRender.entries()) {
          if (controller.signal.aborted) {
            applyAbort();
            return "aborted";
          }

          const frameContext = buildFrameContext(session, settings, clip.index);
          if (!frameContext) continue;

          patchPipelineState(setState, (draft) => {
            draft.stage = "preview";
            draft.stageMessage = `Rendering clip ${queuePosition + 1} of ${clipsToRender.length}…`;
            draft.stageProgress = null;
            const preview = draft.clipPreviews.find((p) => p.clip.index === clip.index);
            if (preview) {
              preview.renderStatus = "rendering";
              preview.renderProgress = 0;
            }
          });

          failedClipIndex = clip.index;

          const job = await runRenderClipJob(
            session,
            frameContext,
            {
              projectId,
              clipIndex: clip.index,
              enabledFormatIds: pendingByClip[clip.index]!,
              filenameStem: stem,
              filenameTemplate,
              renderSignature: clipSignatures[clip.index],
            },
            progress.reporter,
            { signal: controller.signal, previewUrls: previewUrlsRef.current },
          );
          progress.releaseKeys();

          if (!ownsState()) return "aborted";

          // Finished formats are already on disk / in the DB — record them even when the
          // batch was stopped or a sibling format failed.
          patchPipelineState(setState, (draft) => {
            applySuccessfulClipResults(
              draft,
              clip.index,
              job.results,
              selectedByClip[clip.index]!,
              clipSignatures[clip.index]!,
            );
            if (controller.signal.aborted) applyRenderStopState(draft);
          });
          if (controller.signal.aborted) return "aborted";
          if (job.error) throw job.error;
        }

        if (controller.signal.aborted) {
          applyAbort();
          return "aborted";
        }

        persistMetadata({}, "done");
        patchPipelineState(setState, (draft) => {
          draft.stage = "done";
          draft.stageMessage = "Your clips are ready!";
          draft.error = null;
        });
        return "completed";
      } catch (error) {
        if (controller.signal.aborted) {
          applyAbort();
          return "aborted";
        }
        clipperError("pipeline: render failed", error);
        persistMetadata({}, "preview");
        patchPipelineState(setState, (draft) => {
          applyRenderFailureState(
            draft,
            error instanceof Error ? error.message : "Render failed.",
            failedClipIndex,
          );
        });
        return "failed";
      } finally {
        if (activeBatchRef.current === activeBatch) activeBatchRef.current = null;
      }
    },
    [
      abortRef,
      persistMetadata,
      previewUrlsRef,
      projectId,
      reporterRef,
      sessionRef,
      setState,
      settings,
      state.renderProgress,
      state.exportHistory,
      state.renderSignatures,
      state.sourceFileName,
    ],
  );

  const exportCount = Math.max(state.exportHistory.length, persistedExportCount);

  const refreshExportHistory = useCallback(() => {
    void hydrateExportsFromDisk();
  }, [hydrateExportsFromDisk]);

  return {
    renderExports,
    existingExports,
    stopRender,
    exportCount,
    refreshExportHistory,
  };
}
