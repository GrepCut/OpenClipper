import React, { useEffect, useState } from "react";
import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Trash2 } from "lucide-react";
import type { CollageRegion } from "../engine/types/collage.types";
import type { ClipperGeneratedClip } from "../engine/segmentation";
import type { ClipTranscriptEditOp } from "../engine/transcript";
import { globalWordsInClip } from "../engine/transcript/edit.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperClipPreview, WordCue } from "../shared/state.util";
import { ClipperEditableTranscript } from "./clipper-editable-transcript.component";
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
  onEditClipTranscript?: (clipIndex: number, op: ClipTranscriptEditOp) => void;
  onUndoClipEdit?: () => void;
  onRedoClipEdit?: () => void;
  canUndoClipEdit?: boolean;
  canRedoClipEdit?: boolean;
  lastEditedTranscriptRange?: { clipIndex: number; startIdx: number; endIdx: number } | null;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

function clipTimeLabel(preview: ClipperClipPreview): string {
  const { clip } = preview;
  return `${formatDurationMmSs(clip.startSec)}–${formatDurationMmSs(clip.endSec)}`;
}

interface ClipTranscriptBlock {
  timeLabel?: string;
  words: WordCue[];
  wordTimeOffsetSec: number;
  windowStartSec: number;
  windowEndSec: number;
}

function getClipTranscriptBlocks(clip: ClipperGeneratedClip, rangeWords: WordCue[]): ClipTranscriptBlock[] {
  const segments = clip.segments?.length
    ? clip.segments
    : [{ startSec: clip.startSec, endSec: clip.endSec }];

  if (segments.length > 1) {
    return segments.map((segment) => ({
      timeLabel: `${formatDurationMmSs(segment.startSec)}–${formatDurationMmSs(segment.endSec)}`,
      words: sliceWordsForTimeWindow(rangeWords, segment.startSec, segment.endSec),
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

function renderStatusIcon(preview: ClipperClipPreview, theme: ReturnType<typeof useClipperUi>["theme"]) {
  switch (preview.renderStatus) {
    case "done":
      return <CheckCircle2 size={14} color={clipperTheme.accentLight} />;
    case "rendering":
      return <Loader2 size={14} color={clipperTheme.accentLight} className="animate-spin" />;
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
  onEditClipTranscript,
  onUndoClipEdit,
  onRedoClipEdit,
  canUndoClipEdit = false,
  canRedoClipEdit = false,
  lastEditedTranscriptRange = null,
  scrollRef,
}) => {
  const { theme } = useClipperUi();
  const [editingClipIndex, setEditingClipIndex] = useState<number | null>(null);
  const showCollageMarkers = Boolean(onToggleCollageRegion) && editingClipIndex == null;
  const canEdit = Boolean(onEditClipTranscript);

  useEffect(() => {
    if (
      editingClipIndex != null &&
      !clipPreviews.some((preview) => preview.clip.index === editingClipIndex)
    ) {
      setEditingClipIndex(null);
    }
  }, [clipPreviews, editingClipIndex]);

  const virtualizer = useVirtualizer({
    count: clipPreviews.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 230,
    overscan: 3,
    getItemKey: (index) => clipPreviews[index]?.clip.index ?? index,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      const editingIndex = editingClipIndex == null
        ? -1
        : clipPreviews.findIndex((preview) => preview.clip.index === editingClipIndex);
      if (editingIndex >= 0 && !indices.includes(editingIndex)) indices.push(editingIndex);
      return indices.sort((a, b) => a - b);
    },
  });

  if (clipPreviews.length === 0) return null;

  return (
    <VStack align="stretch" gap={4}>
      {!hideTitle ? (
        <Text fontSize="lg" fontWeight="semibold" color={theme.text.primary}>
          Clips
        </Text>
      ) : null}

      <Box position="relative" w="full" h={`${virtualizer.getTotalSize()}px`}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const index = virtualItem.index;
          const preview = clipPreviews[index]!;
          const active = preview.clip.index === activeClipIndex;
          const transcriptBlocks = getClipTranscriptBlocks(preview.clip, rangeWords);
          const statusIcon = renderStatusIcon(preview, theme);
          const clipRegions = filterRegionsForClip(
            collageRegions,
            preview.clip.startSec,
            preview.clip.endSec,
          );
          const isLast = index === clipPreviews.length - 1;
          const isEditing = editingClipIndex === preview.clip.index;
          const clipLastEdited =
            lastEditedTranscriptRange?.clipIndex === preview.clip.index
              ? lastEditedTranscriptRange
              : null;
          const editableWordEntries = isEditing
            ? globalWordsInClip(preview.clip, rangeWords)
            : [];

          return (
            <Box
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              position="absolute"
              top={0}
              left={0}
              w="full"
              transform={`translateY(${virtualItem.start}px)`}
              role="button"
              tabIndex={0}
              px={5}
              py={4}
              borderBottom={isLast ? "none" : "1px solid"}
              borderColor={isEditing ? clipperTheme.accent : theme.border.primary}
              borderLeft={isEditing ? "3px solid" : "3px solid transparent"}
              borderLeftColor={isEditing ? clipperTheme.accent : "transparent"}
              bg={
                isEditing
                  ? `rgba(${clipperTheme.accentTintRgb},0.12)`
                  : active
                    ? `rgba(${clipperTheme.accentTintRgb},0.08)`
                    : "transparent"
              }
              cursor="pointer"
              transition="border-color 0.15s ease, background 0.15s ease"
              _hover={{
                bg: isEditing
                  ? `rgba(${clipperTheme.accentTintRgb},0.16)`
                  : active
                    ? `rgba(${clipperTheme.accentTintRgb},0.12)`
                    : theme.surface.hover,
              }}
              onClick={() => onSelectClip(preview.clip.index)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && isEditing) {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingClipIndex(null);
                  return;
                }
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectClip(preview.clip.index);
                }
              }}
            >
              <VStack align="stretch" gap={2}>
                <HStack align="center" justify="space-between" gap={2} w="full">
                  <HStack gap={2} flexWrap="wrap" flex={1} minW={0}>
                    <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
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
                  {canEdit ? (
                    <IconButton
                      aria-label={
                        isEditing
                          ? `Stop editing clip ${preview.clip.index + 1}`
                          : `Edit clip ${preview.clip.index + 1} transcript`
                      }
                      title={isEditing ? "Done editing" : "Edit transcript"}
                      size="xs"
                      variant="ghost"
                      borderRadius="md"
                      color={isEditing ? clipperTheme.accentLight : theme.text.muted}
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
                        color: clipperTheme.accentLight,
                        opacity: 0.85,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingClipIndex((prev) =>
                          prev === preview.clip.index ? null : preview.clip.index,
                        );
                      }}
                    >
                      <Pencil size={14} strokeWidth={1.75} />
                    </IconButton>
                  ) : null}

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
                  {isEditing && onEditClipTranscript ? (
                    <ClipperEditableTranscript
                      wordEntries={editableWordEntries}
                      lastEditedRange={clipLastEdited}
                      onEdit={(op) => onEditClipTranscript(preview.clip.index, op)}
                      onUndo={onUndoClipEdit}
                      onRedo={onRedoClipEdit}
                      canUndo={canUndoClipEdit}
                      canRedo={canRedoClipEdit}
                    />
                  ) : (
                    transcriptBlocks.map((block, i) => {
                      const blockRegions =
                        transcriptBlocks.length > 1
                          ? filterRegionsForClip(clipRegions, block.windowStartSec, block.windowEndSec)
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
                                    onSeekToTranscriptTime(preview.clip.index, sourceTimeSec)
                                : undefined
                            }
                          />
                        </Box>
                      );
                    })
                  )}
                </VStack>
              </VStack>
            </Box>
          );
        })}
      </Box>
    </VStack>
  );
};
