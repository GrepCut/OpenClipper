import { useCallback } from "react";

import { appendUniqueExportResults } from "../../shared/export-results.util";
import { applyFilenameTemplate, baseName } from "../../shared/filename-template.util";
import type { ClipperFormatResult } from "../../shared/state.util";
import { buildFrameContext } from "../../pipeline/frame-context.util";
import { runRenderClipJob } from "../../pipeline/stages/render.util";
import { getClipperFormatDef } from "../../shared/formats.util";
import { createRenderFailureReporter } from "../../shared/render-failure-report.util";
import { flushPendingClipperExports } from "../../persistence/clipper-export-persist.util";
import { patchPipelineState } from "./clipper-pipeline-state.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineRerender(core: UseClipperPipelineCoreResult) {
  const { projectId, state, setState, settings, refs } = core;
  const { abortRef, previewUrlsRef, sessionRef, reporterRef } = refs;

  const rerenderFormat = useCallback(
    async (formatId: string, clipIndex: number) => {
      const session = sessionRef.current;
      const formatDef = getClipperFormatDef(formatId);
      if (!session?.rangeTrimmedFile) return;
      if (!formatDef) return;

      const frameContext = buildFrameContext(session, settings, clipIndex);
      if (!frameContext) return;

      const progressKey = `${clipIndex}:${formatId}`;
      patchPipelineState(setState, (draft) => {
        draft.renderProgress[progressKey] = null;
      });

      const stem = baseName(state.sourceFileName ?? "clip");
      const signal = abortRef.current?.signal ?? new AbortController().signal;
      const reportFailure = createRenderFailureReporter("rerender", {
        clipIndex,
        quality: settings.formats.quality,
        resolutionCap: settings.formats.resolutionCap,
      });
      try {
        await flushPendingClipperExports(projectId);
        if (signal.aborted || sessionRef.current !== session) return;
        await core.hydrateExportsFromDisk({ retryPending: false });
        if (signal.aborted || sessionRef.current !== session) return;
        const job = await runRenderClipJob(
          session,
          frameContext,
          {
            projectId,
            clipIndex,
            enabledFormatIds: [formatDef.id],
            filenameStem: stem,
            filenameTemplate: settings.formats.filenameTemplate,
          },
          reporterRef.current,
          { signal, previewUrls: previewUrlsRef.current, reportFailure },
        );
        if (signal.aborted) return;
        const result = job.results[0];
        if (!result) throw job.error ?? new Error("Re-render did not produce an export.");

        patchPipelineState(setState, (draft) => {
          draft.renderProgress[progressKey] = 1;
          draft.exportHistory = appendUniqueExportResults(draft.exportHistory, [result]);
          const preview = draft.clipPreviews.find((p) => p.clip.index === clipIndex);
          if (preview) {
            preview.results = appendUniqueExportResults(preview.results, [result]);
          }
        });
        if (job.error) throw job.error;
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
        reportFailure(error, { formatId }, signal);
        patchPipelineState(setState, (draft) => {
          draft.error = error instanceof Error ? error.message : "Re-render failed.";
        });
      }
    },
    [
      abortRef,
      core.hydrateExportsFromDisk,
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

  return { rerenderFormat, download };
}
