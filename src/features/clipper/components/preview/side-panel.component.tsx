import React from "react";
import { Box, HStack } from "@chakra-ui/react";
import { ListOrdered } from "lucide-react";
import {
  OutlinedActionButton,
  getOutlinedActionSurfaceProps,
} from "../../../../shared/components/buttons/outlined-action-button.component";
import { ClipperClipsSection } from "../clipper-clips-section.component";
import { CLIP_SOURCE_MODE_OPTIONS, TOOLBAR_ACTION_BUTTON_PROPS } from "./clipper-preview.constants";
import type { ClipperPreviewSidePanelProps } from "./clipper-preview.types";

export function ClipperPreviewSidePanel({
  theme,
  clipPreviews,
  safeAutoPartsPreviews,
  safeAiPreviews,
  clipSourceMode,
  activeClipIndex,
  onSelectClip,
  onClipSourceModeChange,
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
  aiCurrentClipsJsonChars,
  state,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  seekToTranscriptTime,
  autoPartsSegmentLengthSec,
  onAutoPartsSegmentLengthChange,
  onResetAutoParts,
  autoPartsResegmenting,
  onEditClipTranscript,
  onUndoClipEdit,
  onRedoClipEdit,
  canUndoClipEdit,
  canRedoClipEdit,
  lastEditedTranscriptRange,
  isRendering = false,
  onOpenRenderQueue,
}: ClipperPreviewSidePanelProps) {
  return (
    <Box
      minW={0}
      minH={0}
      w={{ base: "full", lg: "auto" }}
      position={{ base: "relative", lg: "absolute" }}
      top={{ lg: 0 }}
      right={{ lg: 0 }}
      bottom={{ lg: 0 }}
      left={{ lg: "calc(42% + var(--chakra-spacing-10))" }}
      h={{ base: "65vh", lg: "auto" }}
      maxH={{ base: "65vh", lg: "none" }}
      display="flex"
      flexDirection="column"
      overflow="hidden"
      border="1px solid"
      borderColor={theme.border.primary}
      borderRadius="28px"
      bg="transparent"
    >
      {/* Insety 8px (px/pt = 2) — spójne z polem czatu na dole panelu (px=2, pb=2). */}
      <HStack
        flexShrink={0}
        px={2}
        pt={2}
        pb={3}
        justify="space-between"
        gap={3}
        flexWrap="wrap"
        align="center"
      >
        <OutlinedActionButton
          startIcon={<ListOrdered size={16} />}
          onClick={onOpenRenderQueue}
          loading={isRendering}
          loadingText="Rendering…"
          flexShrink={0}
          {...TOOLBAR_ACTION_BUTTON_PROPS}
        >
          Go to render queue
        </OutlinedActionButton>

        <HStack gap={1} flexShrink={0} align="center">
          {CLIP_SOURCE_MODE_OPTIONS.map((option) => {
            const isActive = clipSourceMode === option.value;
            return (
              <Box
                key={option.value}
                as="button"
                type="button"
                onClick={() => onClipSourceModeChange(option.value)}
                aria-pressed={isActive}
                {...TOOLBAR_ACTION_BUTTON_PROPS}
                {...getOutlinedActionSurfaceProps(theme, isActive)}
                borderRadius="xl"
                cursor="pointer"
                fontWeight="medium"
                color={isActive ? theme.text.primary : theme.text.muted}
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                px={4}
              >
                {option.label}
              </Box>
            );
          })}
        </HStack>
      </HStack>

      <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
        <ClipperClipsSection
          clipPreviews={clipPreviews}
          autoPartsClipPreviews={safeAutoPartsPreviews}
          aiClipPreviews={safeAiPreviews}
          clipSourceMode={clipSourceMode}
          activeClipIndex={activeClipIndex}
          onSelectClip={onSelectClip}
          onDeleteAiClip={onDeleteAiClip}
          onDeleteAutoPartsClip={onDeleteAutoPartsClip}
          aiChatMessages={aiChatMessages}
          aiChatLoading={aiChatLoading}
          aiChatError={aiChatError}
          aiChatThinking={aiChatThinking}
          aiChatProgressChars={aiChatProgressChars}
          aiChatModel={aiChatModel}
          onAiChatModelChange={onAiChatModelChange}
          onSendAiChatMessage={onSendAiChatMessage}
          onLoadAiChatHistory={onLoadAiChatHistory}
          onNewAiChat={onNewAiChat}
          aiCurrentClipsJsonChars={aiCurrentClipsJsonChars}
          rangeWords={state.rangeWords}
          collageRegions={collageRegions}
          disabledCollageRegionIds={disabledCollageRegionIds}
          onToggleCollageRegion={onToggleCollageRegion}
          onSeekToTranscriptTime={seekToTranscriptTime}
          autoPartsSegmentLengthSec={autoPartsSegmentLengthSec}
          onAutoPartsSegmentLengthChange={onAutoPartsSegmentLengthChange}
          onResetAutoParts={onResetAutoParts}
          autoPartsResegmenting={autoPartsResegmenting}
          onEditClipTranscript={onEditClipTranscript}
          onUndoClipEdit={onUndoClipEdit}
          onRedoClipEdit={onRedoClipEdit}
          canUndoClipEdit={canUndoClipEdit}
          canRedoClipEdit={canRedoClipEdit}
          lastEditedTranscriptRange={lastEditedTranscriptRange}
        />
      </Box>
    </Box>
  );
}
