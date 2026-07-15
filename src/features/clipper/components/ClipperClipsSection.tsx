import React, { useEffect } from "react";
import { Box, Flex, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { MdAutoAwesome } from "react-icons/md";
import { RotateCcw } from "lucide-react";
import type { CollageRegion } from "../engine/collage";
import type {
  ClipperAiChatMessage,
  ClipperAiClipPickerModel,
} from "../persistence/ai-clip-api";
import type { ClipperClipPreview, ClipSourceMode, WordCue } from "../shared/state";
import type { ClipTranscriptEditOp } from "../engine/clip-transcript-edit";
import type { AutoPartsSegmentLengthSec } from "../persistence/project-metadata";
import {
  AUTO_PARTS_SEGMENT_LENGTH_OPTIONS,
  formatAutoPartsSegmentLengthLabel,
  isPresetAutoPartsSegmentLength,
} from "../engine/clip-segmentation";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import { ClipperAiClipChat } from "./ClipperAiClipChat";
import { ClipperAiChatHistory } from "./ClipperAiChatHistory";
import type { ClipperAiChatPanelView } from "./ClipperAiChatPanelToggle";
import { ClipperClipSelector } from "./ClipperClipSelector";
import { ClipperCustomSegmentLengthModal } from "./ClipperCustomSegmentLengthModal";

interface ClipperClipsSectionProps {
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
  aiChatMessages: ClipperAiChatMessage[];
  aiChatLoading: boolean;
  aiChatError: string | null;
  aiChatThinking: string;
  aiChatProgressChars: number;
  aiChatModel: ClipperAiClipPickerModel;
  onAiChatModelChange: (model: ClipperAiClipPickerModel) => void;
  onSendAiChatMessage: (message: string, preset?: string) => void;
  onLoadAiChatHistory: () => void;
  onNewAiChat?: () => void;
  aiCurrentClipsJsonChars?: number;
  rangeWords: WordCue[];
  collageRegions: CollageRegion[];
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void;
  autoPartsSegmentLengthSec: AutoPartsSegmentLengthSec;
  onAutoPartsSegmentLengthChange: (lengthSec: AutoPartsSegmentLengthSec) => void;
  onResetAutoParts?: () => void;
  autoPartsResegmenting?: boolean;
  onEditClipTranscript?: (clipIndex: number, op: ClipTranscriptEditOp) => void;
  onUndoClipEdit?: () => void;
  onRedoClipEdit?: () => void;
  canUndoClipEdit?: boolean;
  canRedoClipEdit?: boolean;
  lastEditedTranscriptRange?: { clipIndex: number; startIdx: number; endIdx: number } | null;
}

const AUTO_PARTS_LENGTH_OPTIONS = AUTO_PARTS_SEGMENT_LENGTH_OPTIONS.map((value) => ({
  value,
  label: formatAutoPartsSegmentLengthLabel(value),
}));

function ClipperAutoPartsLengthIsland({
  value,
  onChange,
  onReset,
  disabled = false,
}: {
  value: AutoPartsSegmentLengthSec;
  onChange: (lengthSec: AutoPartsSegmentLengthSec) => void;
  onReset?: () => void;
  disabled?: boolean;
}) {
  const { theme } = useClipperUi();
  const accent = clipperTheme.accent;
  const [customModalOpen, setCustomModalOpen] = React.useState(false);
  const isCustom = !isPresetAutoPartsSegmentLength(value);

  const pillButtonProps = (isActive: boolean) => ({
    borderRadius: "full" as const,
    px: 2.5,
    py: 1.5,
    minW: "36px",
    fontSize: "12px",
    fontWeight: isActive ? "700" : "500",
    letterSpacing: "-0.01em" as const,
    color: isActive ? "white" : theme.text.muted,
    bg: isActive ? accent : "transparent",
    border: "1px solid",
    borderColor: isActive ? accent : "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.2s ease",
    _hover:
      !isActive && !disabled
        ? { bg: theme.surface.hover, color: theme.text.primary }
        : undefined,
    _active: disabled ? undefined : { transform: "scale(0.97)" },
  });

  return (
    <>
      <HStack
        justify="center"
        align="center"
        gap={2}
        px={2}
        pb={2}
        pointerEvents="none"
      >
        <Box
          pointerEvents={disabled ? "none" : "auto"}
          opacity={disabled ? 0.6 : 1}
          w="fit-content"
          maxW="100%"
          borderRadius="28px"
          border="1px solid"
          borderColor={theme.border.primary}
          bg={theme.background.tertiary}
          boxShadow={theme.shadow.panel}
          px={3}
          py={2}
          display="flex"
          alignItems="center"
          gap={2.5}
          transition="opacity 0.2s ease"
        >
          <Text
            fontSize="10px"
            fontWeight="700"
            color={theme.text.muted}
            letterSpacing="0.02em"
            userSelect="none"
            flexShrink={0}
          >
            Clip length
          </Text>

          <Flex gap={1} flexShrink={0} alignItems="center">
            {AUTO_PARTS_LENGTH_OPTIONS.map((option) => {
              const isActive = option.value === value;
              return (
                <Box
                  key={option.value}
                  as="button"
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(option.value)}
                  aria-pressed={isActive}
                  {...pillButtonProps(isActive)}
                >
                  {option.label}
                </Box>
              );
            })}
          </Flex>

          <Box w="1px" h="18px" bg={theme.border.primary} flexShrink={0} opacity={0.8} />

          <Box
            as="button"
            type="button"
            disabled={disabled}
            onClick={() => setCustomModalOpen(true)}
            aria-pressed={isCustom}
            {...pillButtonProps(isCustom)}
            minW={isCustom ? "44px" : undefined}
          >
            {isCustom ? formatAutoPartsSegmentLengthLabel(value) : "Custom"}
          </Box>
        </Box>

        {onReset ? (
          <IconButton
            aria-label="Reset clips"
            title="Reset clips"
            size="xs"
            variant="ghost"
            pointerEvents={disabled ? "none" : "auto"}
            opacity={disabled ? 0.6 : 1}
            borderRadius="full"
            border="1px solid"
            borderColor={theme.border.primary}
            bg={theme.background.tertiary}
            boxShadow={theme.shadow.panel}
            color={theme.text.muted}
            flexShrink={0}
            minW="32px"
            h="32px"
            disabled={disabled}
            _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          >
            <RotateCcw size={14} strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </HStack>

      <ClipperCustomSegmentLengthModal
        isOpen={customModalOpen}
        value={value}
        onClose={() => setCustomModalOpen(false)}
        onApply={onChange}
      />
    </>
  );
}

const clipSelectorTranscriptProps = (
  rangeWords: WordCue[],
  collageRegions: CollageRegion[],
  disabledCollageRegionIds: string[],
  onToggleCollageRegion: (regionId: string) => void,
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void,
  editProps?: {
    onEditClipTranscript?: (clipIndex: number, op: ClipTranscriptEditOp) => void;
    onUndoClipEdit?: () => void;
    onRedoClipEdit?: () => void;
    canUndoClipEdit?: boolean;
    canRedoClipEdit?: boolean;
    lastEditedTranscriptRange?: { clipIndex: number; startIdx: number; endIdx: number } | null;
  },
) => ({
  rangeWords,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  onSeekToTranscriptTime,
  ...editProps,
});

const CLIPS_LIST_FADE_HEIGHT = "56px";
const AUTO_PARTS_LENGTH_OVERLAY_PAD = "72px";

function ClipsListBottomFade({
  bottom = 0,
  height = CLIPS_LIST_FADE_HEIGHT,
}: {
  bottom?: number | string;
  height?: number | string;
}) {
  const { theme } = useClipperUi();

  return (
    <Box
      position="absolute"
      bottom={bottom}
      left={0}
      right={0}
      h={height}
      pointerEvents="none"
      zIndex={1}
      bg={`linear-gradient(to top, ${theme.background.primary} 0%, transparent 100%)`}
    />
  );
}

function ClipsListScroller({
  children,
  fadeBottom = 0,
  showBottomFade = true,
  fadeHeight = CLIPS_LIST_FADE_HEIGHT,
  contentPaddingBottom,
  css,
}: {
  children: React.ReactNode;
  fadeBottom?: number | string;
  showBottomFade?: boolean;
  fadeHeight?: number | string;
  contentPaddingBottom?: number | string;
  css: Record<string, unknown>;
}) {
  return (
    <Box position="relative" flex="1" minH={0}>
      <Box position="absolute" inset={0} css={css}>
        <Box css={{ direction: "ltr", minHeight: "100%" }} pb={contentPaddingBottom}>
          {children}
        </Box>
      </Box>
      {showBottomFade ? <ClipsListBottomFade bottom={fadeBottom} height={fadeHeight} /> : null}
    </Box>
  );
}

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
  const [aiPanelView, setAiPanelView] = React.useState<ClipperAiChatPanelView>("clips");
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
        <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
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
                  <MdAutoAwesome size={52} />
                </Box>
                <VStack gap={1.5}>
                  <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
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
          <ClipsListScroller
            showBottomFade
            fadeHeight={AUTO_PARTS_LENGTH_OVERLAY_PAD}
            contentPaddingBottom={AUTO_PARTS_LENGTH_OVERLAY_PAD}
            css={clipsListScrollCss}
          >
            <ClipperClipSelector
              clipPreviews={safeClipPreviews}
              activeClipIndex={activeClipIndex}
              onSelectClip={onSelectClip}
              onDeleteClip={onDeleteAutoPartsClip}
              hideTitle
              {...transcriptProps}
            />
          </ClipsListScroller>

          <Box position="absolute" bottom={0} left={0} right={0} zIndex={2} pointerEvents="none">
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
