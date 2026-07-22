import { useCallback } from "react";

import { CLIPPER_FORMAT_DEFS } from "../../shared/formats.util";
import { appendUniqueExportResults } from "../../shared/export-results.util";
import { applyFilenameTemplate, baseName } from "../../shared/filename-template.util";
import { clipperError } from "../../shared/logger.util";
import type { ClipperFormatResult } from "../../shared/state.util";
import { buildFrameContext, getActiveClips, syncSessionActiveClips } from "../../pipeline/session.util";
import { runRenderClipJob, runRerenderFormat, getClipperFormatDef } from "../../pipeline/stages/render.util";
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

  const renderExports = useCallback(
    async (perClipFormatIds?: Record<number, string[]>) => {
      const session = sessionRef.current;
      if (!session?.rangeTrimmedFile && !session?.trimmedFile) return;

      syncSessionActiveClips(session);
      const activeClips = getActiveClips(session);
      if (activeClips.length === 0) return;

      const formatIdsForClip = (clipIndex: number): string[] =>
        perClipFormatIds?.[clipIndex] ?? settings.formats.enabledFormatIds;
      const formatsForClip = (clipIndex: number) =>
        CLIPPER_FORMAT_DEFS.filter((f) => formatIdsForClip(clipIndex).includes(f.id));

      const clipsToRender = activeClips.filter((clip) => formatsForClip(clip.index).length > 0);
      if (clipsToRender.length === 0) {
        setState((prev) => ({ ...prev, error: "Select at least one export format." }));
        return;
      }
      const renderedClipIndices = new Set(clipsToRender.map((clip) => clip.index));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const initialProgress: Record<string, number | null> = {};
      for (const clip of clipsToRender) {
        for (const f of formatsForClip(clip.index)) initialProgress[`${clip.index}:${f.id}`] = null;
      }

      const stem = baseName(state.sourceFileName ?? "clip");
      const filenameTemplate = settings.formats.filenameTemplate;

      persistMetadata({}, "preview");
      setState((prev) => ({
        ...prev,
        stage: "preview",
        stageMessage: `Rendering ${clipsToRender.length} clip${clipsToRender.length > 1 ? "s" : ""}…`,
        renderProgress: initialProgress,
        error: null,
        clipPreviews: prev.clipPreviews.map((p) =>
          renderedClipIndices.has(p.clip.index)
            ? { ...p, renderStatus: "queued", renderProgress: null, results: [] }
            : p,
        ),
      }));

      let failedClipIndex: number | null = null;

      try {
        for (const [queuePosition, clip] of clipsToRender.entries()) {
          if (controller.signal.aborted) return;

          const frameContext = buildFrameContext(session, settings, clip.index);
          if (!frameContext) continue;

          setState((prev) => ({
            ...prev,
            stage: "preview",
            stageMessage: `Rendering clip ${queuePosition + 1} of ${clipsToRender.length}…`,
            stageProgress: null,
            clipPreviews: prev.clipPreviews.map((p) =>
              p.clip.index === clip.index
                ? { ...p, renderStatus: "rendering", renderProgress: 0 }
                : p,
            ),
          }));

          failedClipIndex = clip.index;

          const clipResults = await runRenderClipJob(
            session,
            frameContext,
            {
              projectId,
              clipIndex: clip.index,
              enabledFormatIds: formatIdsForClip(clip.index),
              filenameStem: stem,
              filenameTemplate,
            },
            reporterRef.current,
            { signal: controller.signal, previewUrls: previewUrlsRef.current },
          );

          for (const r of clipResults) {
            if (r.previewUrl.startsWith("blob:")) {
              previewUrlsRef.current.push(r.previewUrl);
            }
          }

          setState((prev) => ({
            ...prev,
            exportHistory: appendUniqueExportResults(prev.exportHistory, clipResults),
            clipPreviews: prev.clipPreviews.map((p) =>
              p.clip.index === clip.index
                ? {
                    ...p,
                    renderStatus: "done",
                    renderProgress: 1,
                    results: clipResults,
                  }
                : p,
            ),
            renderProgress: {
              ...prev.renderProgress,
              ...Object.fromEntries(
                formatsForClip(clip.index).map((f) => [`${clip.index}:${f.id}`, 1]),
              ),
            },
          }));
        }

        if (controller.signal.aborted) return;

        persistMetadata({}, "done");
        setState((prev) => ({
          ...prev,
          stage: "done",
          stageMessage: "Your clips are ready!",
          error: null,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        clipperError("pipeline: render failed", error);
        persistMetadata({}, "preview");
        setState((prev) => ({
          ...prev,
          stage: "preview",
          stageMessage: "Render failed — adjust preview and try again",
          stageProgress: null,
          error: error instanceof Error ? error.message : "Render failed.",
          clipPreviews: prev.clipPreviews.map((p) => {
            if (failedClipIndex != null && p.clip.index === failedClipIndex) {
              return { ...p, renderStatus: "error" as const };
            }
            if (p.renderStatus === "rendering") {
              return { ...p, renderStatus: "idle" as const, renderProgress: null };
            }
            if (p.renderStatus === "queued") {
              return { ...p, renderStatus: "idle" as const };
            }
            return p;
          }),
        }));
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
      state.sourceFileName,
    ],
  );

  const rerenderFormat = useCallback(
    async (formatId: string, clipIndex: number) => {
      const session = sessionRef.current;
      const formatDef = getClipperFormatDef(formatId);
      if (!session?.rangeTrimmedFile && !session?.trimmedFile) return;
      if (!formatDef) return;

      const frameContext = buildFrameContext(session, settings, clipIndex);
      if (!frameContext) return;

      const progressKey = `${clipIndex}:${formatId}`;
      setState((prev) => ({
        ...prev,
        renderProgress: { ...prev.renderProgress, [progressKey]: null },
      }));

      const stem = baseName(state.sourceFileName ?? "clip");
      try {
        const result = await runRerenderFormat(
          session,
          formatDef,
          frameContext,
          clipIndex,
          {
            projectId,
            filenameStem: stem,
            filenameTemplate: settings.formats.filenameTemplate,
          },
          reporterRef.current,
          { signal: abortRef.current?.signal, previewUrls: previewUrlsRef.current },
        );
        if (result.previewUrl.startsWith("blob:")) {
          previewUrlsRef.current.push(result.previewUrl);
        }

        setState((prev) => ({
          ...prev,
          renderProgress: { ...prev.renderProgress, [progressKey]: 1 },
          exportHistory: appendUniqueExportResults(prev.exportHistory, [result]),
          clipPreviews: prev.clipPreviews.map((p) =>
            p.clip.index === clipIndex
              ? {
                  ...p,
                  results: appendUniqueExportResults(p.results, [result]),
                }
              : p,
          ),
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Re-render failed.",
        }));
      }
    },
    [
      abortRef,
      previewUrlsRef,
      projectId,
      reporterRef,
      sessionRef,
      setState,
      settings,
      state.sourceFileName,
    ],
  );

  const download = useCallback(
    (result: ClipperFormatResult, sourceName: string | null) => {
      const stem = baseName(sourceName ?? "clip");
      const anchor = document.createElement("a");
      anchor.href = result.previewUrl;
      anchor.download = `${applyFilenameTemplate(
        settings.formats.filenameTemplate,
        stem,
        result.formatId,
        result.clipIndex,
      )}.mp4`;
      anchor.click();
    },
    [settings.formats.filenameTemplate],
  );

  const exportCount = Math.max(state.exportHistory.length, persistedExportCount);

  const refreshExportHistory = useCallback(() => {
    void hydrateExportsFromDisk();
  }, [hydrateExportsFromDisk]);

  return {
    renderExports,
    rerenderFormat,
    download,
    exportCount,
    refreshExportHistory,
  };
}
