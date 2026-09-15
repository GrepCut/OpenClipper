import React, { useCallback, useMemo } from "react";
import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { formatDurationMmSs } from "../../../shared/utils/time.util";
import type { RangeFrameContextGetter } from "../engine/types/render.types";
import type { AiClipSegmentRange } from "../engine/types/transcript.types";
import { useClipperCanvasPreview } from "../hooks/use-clipper-canvas-preview.hook";
import { useClipperManualClipRange } from "../hooks/use-clipper-manual-clip-range.hook";
import { CLIPPER_FORMAT_DEFS } from "../shared/formats.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { WordCue } from "../lib/media/transcription-export.util";
import { ClipperManualClipModeSwitch } from "./clipper-manual-clip-mode-switch.component";
import { ClipperManualRangeVideo } from "./clipper-manual-range-video.component";
import { ClipperWordRangeTranscript } from "./clipper-word-range-transcript.component";

const PREVIEW_FORMAT =
  CLIPPER_FORMAT_DEFS.find((format) => format.aspectId === "9-16") ?? CLIPPER_FORMAT_DEFS[0];

const MANUAL_CLIP_SELECT_HINT =
  "Click two words in the transcript to choose where the clip starts and ends.";
const MANUAL_CLIP_WATCH_HINT =
  "Click a word in the transcript to jump to that moment.";

export function ClipperManualClipModal({
  isOpen,
  onClose,
  onSave,
  words,
  durationSec,
  videoUrl,
  initialRange,
  getRangeFrameContext,
  mode,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (range: AiClipSegmentRange) => void;
  words: WordCue[];
  durationSec: number;
  videoUrl: string | null;
  initialRange?: AiClipSegmentRange | null;
  getRangeFrameContext?: RangeFrameContextGetter;
  mode: "create" | "edit";
}) {
  const { theme } = useClipperUi();
  const range = useClipperManualClipRange({
    isOpen,
    words,
    durationSec,
    initialRange,
  });
  const [clipStartSec, clipEndSec] = range.clipTimeRange;
  const clipLengthSec = Math.max(0, clipEndSec - clipStartSec);
  const modalHint =
    range.playbackMode === "select" ? MANUAL_CLIP_SELECT_HINT : MANUAL_CLIP_WATCH_HINT;

  const transcriptWords = useMemo(
    () => words.map((word, index) => ({ word, index })),
    [words],
  );

  const { startIdx, endIdx } = range.selection;
  const frameContext = useMemo(() => {
    if (!isOpen || !getRangeFrameContext) return null;
    const hasRange = startIdx != null && endIdx != null;
    return getRangeFrameContext(
      hasRange ? { wordStartIdx: startIdx, wordEndIdx: endIdx } : null,
    );
  }, [endIdx, getRangeFrameContext, isOpen, startIdx]);
  const getPreviewFrameContext = useCallback(() => frameContext, [frameContext]);

  const canvasPreview = useClipperCanvasPreview({
    video: range.video,
    active: isOpen && frameContext != null,
    format: PREVIEW_FORMAT,
    getFrameContext: getPreviewFrameContext,
  });

  const handleSave = () => {
    if (startIdx == null || endIdx == null) return;
    onSave({ wordStartIdx: startIdx, wordEndIdx: endIdx });
    onClose();
  };

  const footerTime = range.playbackMode === "select" ? (
    <HStack gap={2} flexShrink={0}>
      <Text fontSize="sm" color={theme.text.distinct}>
        {formatDurationMmSs(clipStartSec)} – {formatDurationMmSs(clipEndSec)}
      </Text>
      <Text fontSize="sm" color={clipperTheme.accentLight} fontWeight="semibold">
        · {formatDurationMmSs(clipLengthSec)}
      </Text>
    </HStack>
  ) : (
    <HStack gap={2} flexShrink={0}>
      <Text fontSize="sm" color={theme.text.distinct}>
        {formatDurationMmSs(range.currentTimeSec)}
      </Text>
      <Text fontSize="sm" color={theme.text.muted}>
        / {formatDurationMmSs(durationSec)}
      </Text>
    </HStack>
  );

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title="Manual clip selection"
      description={modalHint}
      size="xl"
      contentWidth="min(calc(100vw - 64px), 1100px)"
      scrollBehavior="inside"
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={handleSave}
          submitText={mode === "edit" ? "Save" : "Add clip"}
          submitDisabled={!range.canSave}
          submitTitle={range.canSave ? undefined : "Select a start word and an end word"}
        />
      }
    >
      <Flex
        direction={{ base: "column", lg: "row" }}
        align="stretch"
        gap={5}
        w="full"
        minH={{ base: "420px", lg: "min(65vh, 640px)" }}
        h={{ base: "auto", lg: "min(65vh, 640px)" }}
      >
        <Box flex="1" minW={0} minH={0} display="flex" flexDirection="column">
          <Box flex="1" minH={0} display="flex" flexDirection="column">
            <ClipperManualRangeVideo
              videoRef={range.bindVideo}
              canvasPreview={
                frameContext && PREVIEW_FORMAT
                  ? { formatId: PREVIEW_FORMAT.id, registerCanvas: canvasPreview.registerCanvas }
                  : null
              }
              videoUrl={videoUrl}
              durationSec={durationSec}
              playbackMode={range.playbackMode}
              clipTimeRange={range.clipTimeRange}
              currentTimeSec={range.currentTimeSec}
              isPlaying={range.isPlaying}
              onTogglePlay={range.togglePlay}
              onClipTimeChange={range.handleClipTimeChange}
              onPlayheadChange={range.handlePlayheadChange}
            />
          </Box>
          <HStack
            justify="space-between"
            align="center"
            gap={4}
            w="full"
            flexShrink={0}
            pt={2}
            px={1}
          >
            {footerTime}
            <ClipperManualClipModeSwitch
              value={range.playbackMode}
              onChange={range.setPlaybackMode}
            />
          </HStack>
        </Box>
        <Box
          flex="1"
          minW={0}
          minH={0}
          display="flex"
          flexDirection="column"
          alignItems="stretch"
          maxH={{ base: "280px", lg: "none" }}
        >
          <ClipperWordRangeTranscript
            words={transcriptWords}
            selection={range.selection}
            onWordClick={range.handleWordClick}
          />
        </Box>
      </Flex>
    </StyledModal>
  );
}
