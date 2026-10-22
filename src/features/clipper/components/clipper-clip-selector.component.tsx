import React from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Virtuoso, type ScrollerProps } from "react-virtuoso";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { CollageRegion } from "../engine/types/collage.types";
import type { ClipperGeneratedClip } from "../engine/segmentation";
import { mapClipWordsToRange } from "../engine/transcript";
import { isEditableKeyboardTarget } from "../shared/keyboard-target.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperClipPreview, WordCue } from "../shared/state.util";
import {
  ClipperInlineTranscript,
  filterRegionsForClip,
} from "./clipper-inline-transcript.component";
import { ClipperDeleteClipConfirm } from "./clipper-delete-clip-confirm.component";
import { ClipActionIconButton } from "./clipper-clip-action-icon-button.component";
import { formatDurationMmSs } from "../../../shared/utils/time.util";
import { useClipperTranscriptEdit } from "./clipper-transcript-edit.context";
import { ClipperTranscriptEditCoachmark } from "./clipper-transcript-edit-coachmark.component";

interface ClipperClipSelectorProps {
  clipPreviews: ClipperClipPreview[];
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onDeleteClip?: (index: number) => void;
  onEditClip?: (index: number) => void;
  onOpenInStudio?: (index: number) => void;
  openingInStudio?: boolean;
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
  /** `rangeWords` index per word (-1 = unmatched). */
  rangeIndices: number[];
  wordTimeOffsetSec: number;
  windowStartSec: number;
  windowEndSec: number;
}

function sliceIndexedWordsForTimeWindow(
  rangeWords: WordCue[],
  startSec: number,
  endSec: number,
): Pick<ClipTranscriptBlock, "words" | "rangeIndices"> {
  const words: WordCue[] = [];
  const rangeIndices: number[] = [];
  rangeWords.forEach((word, index) => {
    if (word.end > startSec && word.start < endSec) {
      words.push(word);
      rangeIndices.push(index);
    }
  });
  return { words, rangeIndices };
}

const transcriptBlocksCache = new WeakMap<
  ClipperGeneratedClip,
  { rangeWords: WordCue[]; blocks: ClipTranscriptBlock[] }
>();

/** Virtuoso re-renders cards on every scroll tick; the clip→range word mapping is not cheap. */
function getClipTranscriptBlocks(
  clip: ClipperGeneratedClip,
  rangeWords: WordCue[],
): ClipTranscriptBlock[] {
  const cached = transcriptBlocksCache.get(clip);
  if (cached && cached.rangeWords === rangeWords) return cached.blocks;
  const blocks = buildClipTranscriptBlocks(clip, rangeWords);
  transcriptBlocksCache.set(clip, { rangeWords, blocks });
  return blocks;
}

function buildClipTranscriptBlocks(
  clip: ClipperGeneratedClip,
  rangeWords: WordCue[],
): ClipTranscriptBlock[] {
  const segments = clip.segments?.length
    ? clip.segments
    : [{ startSec: clip.startSec, endSec: clip.endSec }];

  if (segments.length > 1) {
    return segments.map((segment) => ({
      timeLabel: `${formatDurationMmSs(segment.startSec)}–${formatDurationMmSs(segment.endSec)}`,
      ...sliceIndexedWordsForTimeWindow(
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
  const indexed =
    clip.words.length > 0
      ? {
          words: clip.words,
          rangeIndices: mapClipWordsToRange(clip, rangeWords).map((ref) => ref.rangeIndex),
        }
      : sliceIndexedWordsForTimeWindow(rangeWords, segment.startSec, segment.endSec);

  return [
    {
      ...indexed,
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
  onEditClip,
  onOpenInStudio,
  openingInStudio = false,
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
  const transcriptEdit = useClipperTranscriptEdit();
  const hasTranscript = clipPreviews.some((preview) => preview.clip.words.length > 0);
  const showCoachmark =
    Boolean(transcriptEdit) &&
    !transcriptEdit?.hints.coachSeen &&
    hasTranscript &&
    rangeWords.length > 0;

  if (clipPreviews.length === 0) return null;

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!transcriptEdit || isEditableKeyboardTarget(event.target)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    const redo = key === "y" || event.shiftKey;
    const handled = redo
      ? transcriptEdit.redoTranscriptEdit()
      : transcriptEdit.undoTranscriptEdit();
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

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
    const canEditText = Boolean(transcriptEdit) && rangeWords.length > 0;

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
              {onOpenInStudio ? (
                <ClipActionIconButton
                  aria-label={`Open clip ${preview.clip.index + 1} in Studio`}
                  title={openingInStudio ? "Opening Studio…" : "Open in Studio"}
                  disabled={openingInStudio}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openingInStudio) return;
                    onOpenInStudio(preview.clip.index);
                  }}
                >
                  <ExternalLink size={14} strokeWidth={1.75} />
                </ClipActionIconButton>
              ) : null}
              {onEditClip ? (
                <ClipActionIconButton
                  aria-label={`Edit clip ${preview.clip.index + 1}`}
                  title="Edit clip range"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditClip(preview.clip.index);
                  }}
                >
                  <Pencil size={14} strokeWidth={1.75} />
                </ClipActionIconButton>
              ) : null}
              {onDeleteClip ? (
                <ClipperDeleteClipConfirm
                  onConfirm={() => onDeleteClip(preview.clip.index)}
                >
                  <ClipActionIconButton
                    aria-label={`Delete clip ${preview.clip.index + 1}`}
                    tone="danger"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </ClipActionIconButton>
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
                      rangeIndices={canEditText ? block.rangeIndices : undefined}
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
    <VStack align="stretch" gap={4} flex="1" minH={0} onKeyDown={handleListKeyDown}>
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
            Header: showCoachmark
              ? () => (
                  <ClipperTranscriptEditCoachmark
                    onDismiss={() => transcriptEdit?.markCoachSeen()}
                  />
                )
              : undefined,
            Footer: () => <Box h={bottomInset} />,
          }}
          itemContent={renderClipCard}
        />
      </Box>
    </VStack>
  );
};
