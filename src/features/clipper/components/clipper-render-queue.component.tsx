import React, { useMemo } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  computeOverallProgress,
  countCompletedExports,
  deriveFormatRenderStatus,
  renderProgressKey,
  totalExportJobs,
} from "../shared/render-progress.util";
import { CLIPPER_FORMAT_DEFS, getClipperFormatDef } from "../shared/formats.util";
import { resultsForClip, sortExportsByDate } from "../shared/export-results.util";
import type { ClipperClipPreview, ClipperFormatResult, ClipperPipelineState } from "../shared/state.util";
import { ClipperExportFormatRow, type ClipperPublishTarget } from "./clipper-export-format-row.component";
import { ClipperProgressBar } from "./clipper-progress-bar.component";
import { ClipperRenderFormatProgressRow } from "./clipper-render-format-progress-row.component";
import { formatDurationMmSs } from "../../../shared/utils/time.util";

interface ClipperRenderQueueProps {
  state: ClipperPipelineState;
  clipPreviews: ClipperClipPreview[];
  formatIdsByClip: Record<number, string[]>;
  results: ClipperFormatResult[];
  isRendering: boolean;
  onOpenFolder: () => void;
  onPublish: (result: ClipperFormatResult, target: ClipperPublishTarget) => void;
  onRerenderFormat: (formatId: string, clipIndex: number) => void;
}

function clipTimeLabel(preview: ClipperClipPreview): string {
  const { clip } = preview;
  return `${formatDurationMmSs(clip.startSec)}–${formatDurationMmSs(clip.endSec)}`;
}

function orderedFormatIdsForClip(formatIds: string[]): string[] {
  return CLIPPER_FORMAT_DEFS.map((def) => def.id).filter((id) => formatIds.includes(id));
}

export const ClipperRenderQueue: React.FC<ClipperRenderQueueProps> = ({
  state,
  clipPreviews,
  formatIdsByClip,
  results,
  isRendering,
  onOpenFolder,
  onPublish,
  onRerenderFormat,
}) => {
  const { theme } = useClipperUi();

  const queuedPreviews = useMemo(
    () => clipPreviews.filter((p) => (formatIdsByClip[p.clip.index] ?? []).length > 0),
    [clipPreviews, formatIdsByClip],
  );

  const overallProgress = useMemo(
    () => computeOverallProgress(state.renderProgress, formatIdsByClip),
    [formatIdsByClip, state.renderProgress],
  );

  const exportJobCount = useMemo(() => totalExportJobs(formatIdsByClip), [formatIdsByClip]);

  const doneExportCount = useMemo(
    () => countCompletedExports(state.renderProgress, formatIdsByClip),
    [formatIdsByClip, state.renderProgress],
  );

  const completedExports = useMemo(() => sortExportsByDate(results), [results]);

  const hasPendingRenderJobs = useMemo(
    () =>
      Object.values(state.renderProgress).some(
        (value) => value == null || (typeof value === "number" && value < 1),
      ),
    [state.renderProgress],
  );

  const showProgressUi = isRendering || hasPendingRenderJobs;

  const renderExportRow = (result: ClipperFormatResult) => {
    const progressKey = `${result.clipIndex}:${result.formatId}`;
    const isRerendering =
      state.renderProgress[progressKey] != null && state.renderProgress[progressKey] !== 1;

    return (
      <ClipperExportFormatRow
        key={result.id}
        result={result}
        isRerendering={isRerendering}
        showRerender={isRendering}
        onOpenFolder={onOpenFolder}
        onPublish={onPublish}
        onRerender={onRerenderFormat}
      />
    );
  };

  const renderProgressRows = () =>
    queuedPreviews.flatMap((preview) => {
      const clipResults = resultsForClip(results, preview.clip.index);

      if (isRendering && preview.renderStatus === "done" && clipResults.length > 0) {
        return clipResults.map(renderExportRow);
      }

      const formatIds = orderedFormatIdsForClip(formatIdsByClip[preview.clip.index] ?? []);

      return formatIds.flatMap((formatId) => {
        const formatDef = getClipperFormatDef(formatId);
        if (!formatDef) return [];

        const formatProgress =
          state.renderProgress[renderProgressKey(preview.clip.index, formatId)] ?? null;
        const status = deriveFormatRenderStatus(preview.renderStatus, formatProgress);

        return [
          <ClipperRenderFormatProgressRow
            key={`${preview.clip.index}:${formatId}`}
            formatLabel={formatDef.label}
            platform={formatDef.platform}
            clipLabel={`Clip ${preview.clip.index + 1} ·`}
            clipTimeRange={clipTimeLabel(preview)}
            status={status}
            formatProgress={formatProgress}
          />,
        ];
      });
    });

  return (
    <VStack align="stretch" gap={4}>
      {showProgressUi ? (
        <>
          <Box>
            <Text fontSize="lg" fontWeight="semibold" color={theme.text.primary} mb={1}>
              {state.stageMessage || "Rendering…"}
            </Text>
            <Text fontSize="sm" color={theme.text.muted}>
              {doneExportCount} of {exportJobCount} export{exportJobCount !== 1 ? "s" : ""}{" "}
              complete
            </Text>
          </Box>
          <ClipperProgressBar label="Overall progress" value={overallProgress} />
        </>
      ) : completedExports.length > 0 ? (
        <Box>
          <Text fontSize="lg" fontWeight="semibold" color={theme.text.primary} mb={1}>
            Render complete
          </Text>
          <Text fontSize="sm" color={theme.text.muted}>
            {completedExports.length} export{completedExports.length !== 1 ? "s" : ""} from this
            batch.
          </Text>
        </Box>
      ) : null}

      <VStack align="stretch" gap={2}>
        {showProgressUi ? renderProgressRows() : completedExports.map(renderExportRow)}
      </VStack>
    </VStack>
  );
};
