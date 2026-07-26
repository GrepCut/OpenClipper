import React from "react";
import { Box, Center, Text } from "@chakra-ui/react";
import { ClipperLayout } from "../components/clipper-layout.component";
import { ClipperExportsView } from "../components/clipper-exports-view.component";
import { ClipperRenderQueue } from "../components/clipper-render-queue.component";
import { ClipperRenderQueueSetup } from "../components/clipper-render-queue-setup.component";
import { ClipperProcessing } from "../components/clipper-processing.component";
import { ClipperProjectLoadingPanel } from "../components/clipper-project-loading-panel.component";
import { ClipperTrimSelect } from "../components/clipper-trim-select.component";
import { ClipperUpload } from "../components/clipper-upload.component";
import { ClipperSocialPublishDialog } from "../components/clipper-youtube-publish-dialog.component";
import { ClipperSessionPreviewPanel } from "../components/session/clipper-session-preview-panel.component";
import { useClipperSessionView } from "../hooks/use-clipper-session-view.hook";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperSessionViewProps } from "../shared/clipper-session-view.types";

export type { ClipperSessionViewProps } from "../shared/clipper-session-view.types";

export function ClipperSessionView({ project, token, loaded }: ClipperSessionViewProps) {
  const { theme, errorPanel } = useClipperUi();
  const session = useClipperSessionView({ project, token, loaded });
  const {
    state,
    confirmRange,
    rerenderFormat,
    refreshExportHistory,
    reset,
    sourceUrl,
    rangeLocked,
    handleFile,
    handleOpenExportsFolder,
    step,
    visibility,
    resumeLoadingStatus,
    isRendering,
    sessionResults,
    renderQueue,
    publish,
  } = session;

  return (
    <ClipperLayout
      step={visibility.showLoadingUi ? undefined : step}
      backLink={visibility.layoutBackLink}
    >
      {visibility.showUpload && <ClipperUpload onFile={handleFile} fill />}

      {state.stage === "trimming" && sourceUrl && !rangeLocked && (
        <ClipperTrimSelect
          sourceUrl={sourceUrl}
          sourceDuration={state.sourceDuration ?? 60}
          initialStartSec={state.clipStart > 0 ? state.clipStart : undefined}
          initialEndSec={state.clipEnd ?? state.sourceDuration ?? undefined}
          sourceFileName={state.sourceFileName}
          onConfirm={(start, end) => {
            void confirmRange(start, end);
          }}
          onCancel={reset}
        />
      )}

      {visibility.showRestoreLoader && (
        <Center py={12}>
          <ClipperProjectLoadingPanel status={resumeLoadingStatus} />
        </Center>
      )}

      {visibility.showFreshProcessing && (
        <Center py={12}>
          <Box maxW="560px" w="full">
            <ClipperProcessing state={state} />
          </Box>
        </Center>
      )}

      {visibility.showPreview && <ClipperSessionPreviewPanel session={session} />}

      {visibility.showQueueSetup && (
        <ClipperRenderQueueSetup
          clipPreviews={state.clipPreviews}
          rangeTrimmedVideoUrl={state.rangeTrimmedVideoUrl!}
          getClipFormatIds={renderQueue.getClipFormatIds}
          onToggleClipFormat={renderQueue.toggleClipFormat}
          onSetFormatForAll={renderQueue.setFormatForAllClips}
          onSetAllFormatsForClip={renderQueue.setAllFormatsForClip}
          isRendering={isRendering}
          onRender={renderQueue.startQueuedRender}
        />
      )}

      {visibility.showQueueProgress && (
        <ClipperRenderQueue
          state={state}
          clipPreviews={state.clipPreviews}
          formatIdsByClip={renderQueue.formatIdsByClip}
          results={sessionResults}
          isRendering={isRendering}
          onOpenFolder={handleOpenExportsFolder}
          onPublish={publish.openPublishDialog}
          onRerenderFormat={(formatId, clipIndex) => void rerenderFormat(formatId, clipIndex)}
        />
      )}

      {visibility.showExports && (
        <ClipperExportsView
          exportHistory={state.exportHistory}
          sourceFileName={state.sourceFileName}
          projectId={project.id}
          onRefreshHistory={refreshExportHistory}
        />
      )}

      <ClipperSocialPublishDialog
        isOpen={publish.queuePublishTarget != null}
        onClose={publish.closePublishDialog}
        projectId={project.id}
        result={publish.queuePublishTarget}
        sourceFileName={state.sourceFileName}
        defaultConnected={publish.queuePublishConnection.connected}
        accountLabel={publish.queuePublishConnection.accountLabel}
        publishPlatform={publish.queuePublishPlatform}
        onRequestConnect={publish.handleRequestConnect}
      />

      {state.stage === "error" && (
        <Box p={6} borderRadius="2xl" {...errorPanel}>
          <Text color={theme.status.danger} fontWeight="semibold" mb={2}>
            Something went wrong
          </Text>
          <Text color={theme.text.muted} mb={4}>
            {state.error}
          </Text>
          <ClipperUpload onFile={handleFile} />
        </Box>
      )}
    </ClipperLayout>
  );
}
