import React, { useCallback } from "react";
import { Box, Text } from "@chakra-ui/react";
import { ClipperPreview } from "../preview/clipper-preview.component";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import type { useClipperSessionView } from "../../hooks/use-clipper-session-view.hook";

type SessionView = ReturnType<typeof useClipperSessionView>;

export interface ClipperSessionPreviewPanelProps {
  session: SessionView;
}

export const ClipperSessionPreviewPanel: React.FC<ClipperSessionPreviewPanelProps> = ({
  session,
}) => {
  const { theme, errorPanel } = useClipperUi();
  const {
    project,
    state,
    settings,
    updateSettings,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    loadAiChatHistory,
    sendAiClipChatMessage,
    startNewAiChat,
    deleteAiClip,
    deleteAutoPartsClip,
    aiCurrentClipsJsonChars,
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    setAiChatModel,
    disabledCollageRegionIds,
    toggleCollageRegion,
    isRendering,
    canUseAccountFeatures,
    publish,
    renderQueue,
  } = session;

  const guardAccount = useCallback(() => {
    if (canUseAccountFeatures) return true;
    publish.requestAccount();
    return false;
  }, [canUseAccountFeatures, publish]);

  return (
    <>
      {state.error && (
        <Box mb={4} p={4} borderRadius="xl" {...errorPanel}>
          <Text color={theme.status.danger} fontSize="sm">
            {state.error}
          </Text>
        </Box>
      )}
      <ClipperPreview
        projectId={project.id}
        state={state}
        rangeTrimmedVideoUrl={state.rangeTrimmedVideoUrl}
        clipPreviews={state.clipPreviews}
        autoPartsClipPreviews={state.autoPartsClipPreviews ?? state.clipPreviews}
        aiClipPreviews={state.aiClipPreviews ?? []}
        clipSourceMode={state.clipSourceMode ?? "auto-parts"}
        activeClipIndex={state.activeClipIndex}
        onSelectClip={setActiveClipIndex}
        onClipSourceModeChange={(mode) => {
          if (mode === "ai" && !guardAccount()) return;
          setClipSourceMode(mode);
        }}
        aiChatMessages={aiChatMessages}
        aiChatLoading={aiChatLoading}
        aiChatError={aiChatError}
        aiChatThinking={aiChatThinking}
        aiChatProgressChars={aiChatProgressChars}
        aiChatModel={aiChatModel}
        onAiChatModelChange={setAiChatModel}
        onSendAiChatMessage={(message, preset) => {
          if (!guardAccount()) return;
          void sendAiClipChatMessage(message, { preset });
        }}
        onLoadAiChatHistory={() => {
          if (!canUseAccountFeatures) return;
          void loadAiChatHistory();
        }}
        onNewAiChat={() => {
          if (!guardAccount()) return;
          void startNewAiChat();
        }}
        onDeleteAiClip={deleteAiClip}
        onDeleteAutoPartsClip={deleteAutoPartsClip}
        aiCurrentClipsJsonChars={aiCurrentClipsJsonChars}
        settings={settings}
        onUpdateSettings={updateSettings}
        getFrameContext={getFrameContext}
        sourceFileName={state.sourceFileName}
        isRendering={isRendering}
        onOpenRenderQueue={renderQueue.openRenderQueue}
        guardAccount={guardAccount}
        disabledCollageRegionIds={disabledCollageRegionIds}
        onToggleCollageRegion={toggleCollageRegion}
        autoPartsSegmentLengthSec={autoPartsSegmentLengthSec}
        onAutoPartsSegmentLengthChange={(lengthSec) => {
          void resegmentAutoParts(lengthSec);
        }}
        onResetAutoParts={() => {
          void resegmentAutoParts(autoPartsSegmentLengthSec, { force: true });
        }}
        autoPartsResegmenting={autoPartsResegmenting}
      />
    </>
  );
};
