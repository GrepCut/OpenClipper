import React, { useCallback } from "react";
import { Box, Checkbox, HStack, Text, VStack } from "@chakra-ui/react";
import { CLIPPER_FORMAT_DEFS, getClipperCardFrameSize } from "../shared/formats.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperClipPreview } from "../shared/state.util";
import { formatDurationMmSs } from "../../../shared/utils/time.util";
import {
  SIDE_FORMAT_DEFS,
  SMALL_THUMB_HEIGHT,
  THUMB_HEIGHT,
  THUMB_SCALE,
  THUMB_WIDTH,
  isRenderQueueHeroSelected,
} from "./clipper-render-queue-setup.util";

export interface ClipperRenderQueueSetupRowProps {
  preview: ClipperClipPreview;
  selectedIds: string[];
  exported?: Record<string, string>;
  skipExisting: boolean;
  transcript: string;
  registerThumbRow: (clipIndex: number, el: HTMLElement | null) => void;
  setCanvasRef: (clipIndex: number, formatId: string, el: HTMLCanvasElement | null) => void;
  onToggleClipFormat: (clipIndex: number, formatId: string) => void;
  onSetAllFormatsForClip: (clipIndex: number, enabled: boolean) => void;
}

export const ClipperRenderQueueSetupRow = React.memo(function ClipperRenderQueueSetupRow({
  preview,
  selectedIds,
  exported,
  skipExisting,
  transcript,
  registerThumbRow,
  setCanvasRef,
  onToggleClipFormat,
  onSetAllFormatsForClip,
}: ClipperRenderQueueSetupRowProps) {
  const { theme } = useClipperUi();
  const clipIndex = preview.clip.index;
  const heroSelected = isRenderQueueHeroSelected(selectedIds);

  const rowRef = useCallback(
    (el: HTMLDivElement | null) => registerThumbRow(clipIndex, el),
    [clipIndex, registerThumbRow],
  );

  return (
    <HStack
      ref={rowRef}
      gap={4}
      p={3}
      align="center"
      borderRadius="xl"
      border="1px solid"
      borderColor={theme.surface.hover}
      bg={theme.surface.faint}
    >
      <HStack gap={2} flexShrink={0} align="start">
        <Box
          w={`${THUMB_WIDTH}px`}
          h={`${THUMB_HEIGHT}px`}
          borderRadius="lg"
          overflow="hidden"
          bg={theme.background.surface}
          flexShrink={0}
          display={heroSelected ? undefined : "none"}
        >
          <canvas
            ref={(el) => setCanvasRef(clipIndex, "main", el)}
            width={THUMB_WIDTH * THUMB_SCALE}
            height={THUMB_HEIGHT * THUMB_SCALE}
            aria-label={`Clip ${clipIndex + 1} preview`}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </Box>

        <Box display="flex" flexWrap="wrap" gap="8px" w="212px" alignContent="flex-start">
          {SIDE_FORMAT_DEFS.map((def) => {
            const frame = getClipperCardFrameSize(def.id, SMALL_THUMB_HEIGHT);
            return (
              <Box
                key={def.id}
                w={`${frame.width}px`}
                h={`${frame.height}px`}
                borderRadius="md"
                overflow="hidden"
                bg={theme.background.surface}
                title={def.label}
                display={selectedIds.includes(def.id) ? undefined : "none"}
              >
                <canvas
                  ref={(el) => setCanvasRef(clipIndex, def.id, el)}
                  width={frame.width * THUMB_SCALE}
                  height={frame.height * THUMB_SCALE}
                  aria-label={`Clip ${clipIndex + 1} ${def.label} preview`}
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
              </Box>
            );
          })}
        </Box>
      </HStack>

      <VStack align="start" gap={1} flexShrink={0} w="96px">
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Clip {clipIndex + 1}
        </Text>
        <Text fontSize="xs" color={theme.text.muted}>
          {formatDurationMmSs(preview.clip.startSec)}–{formatDurationMmSs(preview.clip.endSec)}
        </Text>
        <Text fontSize="xs" color={theme.text.toggleThumbInactive}>
          {Math.round(preview.clip.durationSec)}s
        </Text>
        {selectedIds.length === 0 ? (
          <Text fontSize="xs" color={theme.text.toggleThumbInactive} fontStyle="italic">
            Skipped
          </Text>
        ) : null}
      </VStack>

      <Text
        fontSize="sm"
        color={transcript ? theme.text.muted : theme.text.toggleThumbInactive}
        fontStyle={transcript ? undefined : "italic"}
        lineClamp={4}
        flex={1}
        minW={0}
      >
        {transcript || "No transcript for this clip."}
      </Text>

      <VStack
        align="start"
        gap={1.5}
        flexShrink={0}
        pl={4}
        borderLeft="1px solid"
        borderColor={theme.surface.hover}
      >
        <Text
          as="button"
          fontSize="xs"
          fontWeight="medium"
          color={clipperTheme.accentLight}
          cursor="pointer"
          _hover={{ textDecoration: "underline" }}
          onClick={() => onSetAllFormatsForClip(clipIndex, selectedIds.length === 0)}
        >
          {selectedIds.length === 0 ? "Select all" : "Deselect all"}
        </Text>
        {CLIPPER_FORMAT_DEFS.map((def) => {
          const exportedAt = exported?.[def.id];
          const willSkip = exportedAt !== undefined && skipExisting && selectedIds.includes(def.id);
          return (
            <Checkbox.Root
              key={def.id}
              size="sm"
              colorPalette="blue"
              checked={selectedIds.includes(def.id)}
              onCheckedChange={() => onToggleClipFormat(clipIndex, def.id)}
              title={
                exportedAt !== undefined
                  ? `Exported ${new Date(exportedAt).toLocaleString()}${willSkip ? " · will be skipped" : ""}`
                  : undefined
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control opacity={willSkip ? 0.5 : undefined}>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Label>
                <HStack gap={1.5}>
                  <Text
                    fontSize="xs"
                    color={exportedAt !== undefined ? theme.status.danger : theme.text.onBrandMuted}
                    textDecoration={willSkip ? "line-through" : undefined}
                  >
                    {def.label}
                  </Text>
                  {exportedAt !== undefined ? (
                    <Text
                      as="span"
                      fontSize="2xs"
                      fontWeight="semibold"
                      px={1.5}
                      borderRadius="sm"
                      border="1px solid"
                      borderColor={theme.status.danger}
                      color={theme.status.danger}
                    >
                      Exported
                    </Text>
                  ) : null}
                </HStack>
              </Checkbox.Label>
            </Checkbox.Root>
          );
        })}
      </VStack>
    </HStack>
  );
});
