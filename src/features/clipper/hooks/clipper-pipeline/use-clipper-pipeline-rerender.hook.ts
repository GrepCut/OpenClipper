import { useCallback } from "react";

import { appendUniqueExportResults } from "../../shared/export-results.util";
import { applyFilenameTemplate, baseName } from "../../shared/filename-template.util";
import type { ClipperFormatResult } from "../../shared/state.util";
import { buildFrameContext } from "../../pipeline/frame-context.util";
import { runRerenderFormat, getClipperFormatDef } from "../../pipeline/stages/render.util";
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

        patchPipelineState(setState, (draft) => {
          draft.renderProgress[progressKey] = 1;
          draft.exportHistory = appendUniqueExportResults(draft.exportHistory, [result]);
          const preview = draft.clipPreviews.find((p) => p.clip.index === clipIndex);
          if (preview) {
            preview.results = appendUniqueExportResults(preview.results, [result]);
          }
        });
      } catch (error) {
        patchPipelineState(setState, (draft) => {
          draft.error = error instanceof Error ? error.message : "Re-render failed.";
        });
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

  return { rerenderFormat, download };
}
