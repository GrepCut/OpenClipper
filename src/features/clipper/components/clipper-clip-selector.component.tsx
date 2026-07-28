import React from "react";
import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { Virtuoso, type ScrollerProps } from "react-virtuoso";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
} from "lucide-react";
import type { CollageRegion } from "../engine/types/collage.types";
import type { ClipperGeneratedClip } from "../engine/segmentation";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperClipPreview, WordCue } from "../shared/state.util";
import {
  ClipperInlineTranscript,
  filterRegionsForClip,
  sliceWordsForTimeWindow,
} from "./clipper-inline-transcript.component";
import { ClipperDeleteClipConfirm } from "./clipper-delete-clip-confirm.component";
import { formatDurationMmSs } from "../../../shared/utils/time.util";

interface ClipperClipSelectorProps {
  clipPreviews: ClipperClipPreview[];
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  /** When provided, shows a per-clip delete button (e.g. for AI-generated clips). */
  onDeleteClip?: (index: number) => void;
  hideTitle?: boolean;
  rangeWords?: WordCue[];
  collageRegions?: CollageRegion[];
  disabledCollageRegionIds?: string[];
  onToggleCollageRegion?: (regionId: string) => void;
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void;
  bottomInset?: number | string;
}

function clipTimeLabel(preview: ClipperClipPreview): string {
  const { clip } = preview;
  return `${formatDurationMmSs(clip.startSec)}–${formatDurationMmSs(clip.endSec)}`;
}

/** Keep the native scrollbar on the left without letting RTL reposition Virtuoso's viewport. */
const ClipperVirtuosoScroller = React.forwardRef<HTMLDivElement, ScrollerProps>(
  ({ style, ...props }, ref) => {
    const { theme } = useClipperUi();

    return (
      <Box
        {...props}
        ref={ref}
        style={{
          ...style,
          direction: "rtl",
          overflowX: "hidden",
        }}
        css={{
          scrollbarWidth: "thin",
          scrollbarColor: `${theme.scrollbar.thumb} ${theme.scrollbar.track}`,
          "&::-webkit-scrollbar": {
            width: "4px",
            height: "4px",
          },
          "&::-webkit-scrollbar-track": {
            background: theme.scrollbar.track,
          },
          "&::-webkit-scrollbar-thumb": {
            background: theme.scrollbar.thumb,
            borderRadius: "999px",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            background: theme.brand.purpleLight,
          },
          // Virtuoso positions this node absolutely. In an RTL containing block
          // its implicit horizontal position can change after item re-measurement.
          '& > [data-viewport-type="element"]': {
            direction: "ltr",
            left: "0 !important",
            right: "0 !important",
            width: "auto !important",
            minWidth: 0,
            boxSizing: "border-box",
          },
        }}
      />
    );
  },
);

ClipperVirtuosoScroller.displayName = "ClipperVirtuosoScroller";

interface ClipTranscriptBlock {
  timeLabel?: string;
  words: WordCue[];
  wordTimeOffsetSec: number;
  windowStartSec: number;
  windowEndSec: number;
}

function getClipTranscriptBlocks(
  clip: ClipperGeneratedClip,
  rangeWords: WordCue[],
): ClipTranscriptBlock[] {
  const segments = clip.segments?.length
    ? clip.segments
    : [{ startSec: clip.startSec, endSec: clip.endSec }];

  if (segments.length > 1) {
    return segments.map((segment) => ({
      timeLabel: `${formatDurationMmSs(segment.startSec)}–${formatDurationMmSs(segment.endSec)}`,
      words: sliceWordsForTimeWindow(
        rangeWords,
        segment.startSec,
        segment.endSec,
      ),
      wordTimeOffsetSec: 0,
      windowStartSec: segment.startSec,
      windowEndSec: segment.endSec,
    }));
  }

  const segment = segments[0];
  const words =
    clip.words.length > 0
      ? clip.words
      : sliceWordsForTimeWindow(rangeWords, segment.startSec, segment.endSec);

  return [
    {
      words,
      wordTimeOffsetSec: clip.words.length > 0 ? clip.startSec : 0,
      windowStartSec: segment.startSec,
      windowEndSec: segment.endSec,
    },
  ];
}

function renderStatusIcon(
  preview: ClipperClipPreview,
  theme: ReturnType<typeof useClipperUi>["theme"],
) {
  switch (preview.renderStatus) {
    case "done":
      return <CheckCircle2 size={14} color={clipperTheme.accentLight} />;
    case "rendering":
      return (
        <Loader2
          size={14}
          color={clipperTheme.accentLight}
          className="animate-spin"
        />
      );
    case "error":
      return <AlertCircle size={14} color={theme.status.danger} />;
    default:
      return null;
  }
}

export const ClipperClipSelector: React.FC<ClipperClipSelectorProps> = ({
  clipPreviews,
  activeClipIndex,
  onSelectClip,
  onDeleteClip,
  hideTitle = false,
  rangeWords = [],
  collageRegions = [],
  disabledCollageRegionIds = [],
  onToggleCollageRegion,
  onSeekToTranscriptTime,
  bottomInset = 0,
}) => {
  const { theme } = useClipperUi();
  const showCollageMarkers = Boolean(onToggleCollageRegion);

  if (clipPreviews.length === 0) return null;

  const renderClipCard = (index: number, preview: ClipperClipPreview) => {
    const active = preview.clip.index === activeClipIndex;
    const transcriptBlocks = getClipTranscriptBlocks(preview.clip, rangeWords);
    const statusIcon = renderStatusIcon(preview, theme);
    const clipRegions = filterRegionsForClip(
      collageRegions,
      preview.clip.startSec,
      preview.clip.endSec,
    );
    const isLast = index === clipPreviews.length - 1;

    return (
      <Box
        w="full"
        role="button"
        tabIndex={0}
        px={5}
        py={4}
        borderBottom={isLast ? "none" : "1px solid"}
        borderColor={theme.border.primary}
        borderLeft="3px solid transparent"
        bg={
          active ? `rgba(${clipperTheme.accentTintRgb},0.08)` : "transparent"
        }
        cursor="pointer"
        transition="border-color 0.15s ease, background 0.15s ease"
        _hover={{
          bg: active
            ? `rgba(${clipperTheme.accentTintRgb},0.12)`
            : theme.surface.hover,
        }}
        onClick={() => onSelectClip(preview.clip.index)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectClip(preview.clip.index);
          }
        }}
      >
        <VStack align="stretch" gap={2}>
          <HStack align="center" justify="space-between" gap={2} w="full">
            <HStack gap={2} flexWrap="wrap" flex={1} minW={0}>
              <Text
                fontSize="sm"
                fontWeight="semibold"
                color={theme.text.primary}
              >
                Clip {preview.clip.index + 1}
              </Text>
              <Text fontSize="xs" color={theme.text.muted}>
                {clipTimeLabel(preview)}
              </Text>
              <Text fontSize="xs" color={theme.text.toggleThumbInactive}>
                {Math.round(preview.clip.durationSec)}s
              </Text>
              {statusIcon ? <Box flexShrink={0}>{statusIcon}</Box> : null}
            </HStack>

            <HStack gap={0} flexShrink={0}>
              {onDeleteClip ? (
                <ClipperDeleteClipConfirm
                  onConfirm={() => onDeleteClip(preview.clip.index)}
                >
                  <IconButton
                    aria-label={`Delete clip ${preview.clip.index + 1}`}
                    size="xs"
                    variant="ghost"
                    borderRadius="md"
                    color={theme.status.danger}
                    bg="transparent"
                    border="none"
                    flexShrink={0}
                    alignSelf="flex-end"
                    minW="0"
                    w="auto"
                    h="auto"
                    p={1}
                    _hover={{
                      bg: "transparent",
                      color: theme.status.danger,
                      opacity: 0.85,
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </IconButton>
                </ClipperDeleteClipConfirm>
              ) : null}
            </HStack>
          </HStack>

          <VStack align="stretch" gap={2} w="full">
            {transcriptBlocks.map((block, i) => {
                const blockRegions =
                  transcriptBlocks.length > 1
                    ? filterRegionsForClip(
                        clipRegions,
                        block.windowStartSec,
                        block.windowEndSec,
                      )
                    : clipRegions;

                return (
                  <Box key={i}>
                    {block.timeLabel ? (
                      <Text
                        fontSize="xs"
                        fontWeight="semibold"
                        color={theme.text.toggleThumbInactive}
                        fontFamily="mono"
                        mb={1}
                      >
                        {block.timeLabel}
                      </Text>
                    ) : null}
                    <ClipperInlineTranscript
                      words={block.words}
                      wordTimeOffsetSec={block.wordTimeOffsetSec}
                      regions={blockRegions}
                      disabledRegionIds={disabledCollageRegionIds}
                      onToggleRegion={onToggleCollageRegion ?? (() => {})}
                      showCollageMarkers={showCollageMarkers}
                      emptyMessage="No transcript for this clip."
                      onWordClick={
                        onSeekToTranscriptTime
                          ? (sourceTimeSec) =>
                              onSeekToTranscriptTime(
                                preview.clip.index,
                                sourceTimeSec,
                              )
                          : undefined
                      }
                    />
                  </Box>
                );
              })}
          </VStack>
        </VStack>
      </Box>
    );
  };

  return (
    <VStack align="stretch" gap={4} flex="1" minH={0}>
      {!hideTitle ? (
        <Text fontSize="lg" fontWeight="semibold" color={theme.text.primary}>
          Clips
        </Text>
      ) : null}

      <Box flex="1" minH={0}>
        <Virtuoso
          data={clipPreviews}
          computeItemKey={(_, preview) => preview.clip.index}
          defaultItemHeight={360}
          increaseViewportBy={{ top: 720, bottom: 960 }}
          overscan={{ reverse: 360, main: 720 }}
          style={{
            height: "100%",
            contain: "strict",
            overflowAnchor: "none",
          }}
          components={{
            Scroller: ClipperVirtuosoScroller,
            Footer: () => <Box h={bottomInset} />,
          }}
          itemContent={renderClipCard}
        />
      </Box>
    </VStack>
  );
};
