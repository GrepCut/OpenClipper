import React, { useEffect } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperAiClipChat } from "./clipper-ai-clip-chat.component";
import { ClipperAiChatHistory } from "./clipper-ai-chat-history.component";
import type { ClipperAiChatPanelView } from "./clipper-ai-chat-panel-toggle.component";
import { ClipperAutoPartsLengthIsland } from "./clipper-auto-parts-length-island.component";
import { ClipperClipSelector } from "./clipper-clip-selector.component";
import { ClipsListScroller } from "./clipper-clips-list-scroller.component";
import {
  AUTO_PARTS_LENGTH_OVERLAY_PAD,
  clipSelectorTranscriptProps,
  type ClipperClipsSectionProps,
} from "./clipper-clips-section.types";

export const ClipperClipsSection: React.FC<ClipperClipsSectionProps> = ({
  clipPreviews,
  autoPartsClipPreviews,
  aiClipPreviews,
  clipSourceMode,
  activeClipIndex,
  onSelectClip,
  onDeleteAiClip,
  onDeleteAutoPartsClip,
  aiChatMessages,
  aiChatLoading,
  aiChatError,
  aiChatThinking,
  aiChatProgressChars,
  aiChatModel,
  onAiChatModelChange,
  onSendAiChatMessage,
  onLoadAiChatHistory,
  onNewAiChat,
  aiCurrentClipsJsonChars = 0,
  rangeWords,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  onSeekToTranscriptTime,
  autoPartsSegmentLengthSec,
  onAutoPartsSegmentLengthChange,
  onResetAutoParts,
  autoPartsResegmenting = false,
  onEditClipTranscript,
  onUndoClipEdit,
  onRedoClipEdit,
  canUndoClipEdit,
  canRedoClipEdit,
  lastEditedTranscriptRange,
}) => {
  const { theme, leftScrollbarCss } = useClipperUi();
  const isAiMode = clipSourceMode === "ai";
  const safeAutoPartsPreviews = autoPartsClipPreviews ?? [];
  const safeAiPreviews = aiClipPreviews ?? [];
  const safeClipPreviews = clipPreviews ?? safeAutoPartsPreviews;
  const listPreviews = isAiMode ? safeAiPreviews : safeAutoPartsPreviews;
  const aiHistoryRequestedRef = React.useRef(false);
  const [aiPanelView, setAiPanelView] =
    React.useState<ClipperAiChatPanelView>("clips");
  const transcriptProps = clipSelectorTranscriptProps(
    rangeWords,
    collageRegions,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    onSeekToTranscriptTime,
    {
      onEditClipTranscript,
      onUndoClipEdit,
      onRedoClipEdit,
      canUndoClipEdit,
      canRedoClipEdit,
      lastEditedTranscriptRange,
    },
  );

  useEffect(() => {
    if (!isAiMode) {
      aiHistoryRequestedRef.current = false;
      setAiPanelView("clips");
      return;
    }
    if (aiHistoryRequestedRef.current) return;
    aiHistoryRequestedRef.current = true;
    onLoadAiChatHistory();
  }, [isAiMode, onLoadAiChatHistory]);

  if (safeAutoPartsPreviews.length === 0 && safeAiPreviews.length === 0) {
    return null;
  }

  const clipsListScrollCss = leftScrollbarCss;

  return (
    <Box flex="1" minH={0} display="flex" flexDirection="column">
      {isAiMode ? (
        <Box
          flex="1"
          minH={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          {aiPanelView === "history" ? (
            <ClipsListScroller showBottomFade={false} css={clipsListScrollCss}>
              <ClipperAiChatHistory messages={aiChatMessages} />
            </ClipsListScroller>
          ) : listPreviews.length > 0 ? (
            <ClipsListScroller showBottomFade={false} css={clipsListScrollCss}>
              <ClipperClipSelector
                clipPreviews={listPreviews}
                activeClipIndex={activeClipIndex}
                onSelectClip={onSelectClip}
                onDeleteClip={onDeleteAiClip}
                hideTitle
                {...transcriptProps}
              />
            </ClipsListScroller>
          ) : (
            <Box
              flex="1"
              minH={0}
              display="flex"
              alignItems="center"
              justifyContent="center"
              px={6}
            >
              <VStack gap={4} textAlign="center" maxW="360px">
                <Box color={clipperTheme.accentLight} opacity={0.9}>
                  <Sparkles size={52} />
                </Box>
                <VStack gap={1.5}>
                  <Text
                    fontSize="sm"
                    fontWeight="semibold"
                    color={theme.text.primary}
                  >
                    No AI clips yet
                  </Text>
                  <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
                    Describe the clips you want in the chat below.
                  </Text>
                </VStack>
              </VStack>
            </Box>
          )}

          <Box flexShrink={0} bg="transparent">
            <ClipperAiClipChat
              messages={aiChatMessages}
              loading={aiChatLoading}
              error={aiChatError}
              thinking={aiChatThinking}
              progressChars={aiChatProgressChars}
              model={aiChatModel}
              onModelChange={onAiChatModelChange}
              onSend={onSendAiChatMessage}
              panelView={aiPanelView}
              onPanelViewChange={setAiPanelView}
              onClearContext={onNewAiChat}
              rangeWords={rangeWords}
              currentClipsJsonChars={aiCurrentClipsJsonChars}
            />
          </Box>
        </Box>
      ) : (
        <Box
          position="relative"
          flex="1"
          minH={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          <ClipperClipSelector
            clipPreviews={safeClipPreviews}
            activeClipIndex={activeClipIndex}
            onSelectClip={onSelectClip}
            onDeleteClip={onDeleteAutoPartsClip}
            hideTitle
            bottomInset={AUTO_PARTS_LENGTH_OVERLAY_PAD}
            {...transcriptProps}
          />

          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            zIndex={2}
            pointerEvents="none"
          >
            <ClipperAutoPartsLengthIsland
              value={autoPartsSegmentLengthSec}
              onChange={onAutoPartsSegmentLengthChange}
              onReset={onResetAutoParts}
              disabled={autoPartsResegmenting}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
