import React, { useRef } from "react";
import { Box, Text } from "@chakra-ui/react";
import type { WordCue } from "../lib/media/transcription-export.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperTranscriptEmpty } from "./clipper-transcript-empty.component";
import type { WordRangeSelection } from "./clipper-manual-clip-range.util";
import { nearestWordIndexFromPointer } from "./clipper-transcript-word-pointer.util";

/** Flat range tint — violet, readable on dark transcript without pill blocks. */
const MANUAL_CLIP_RANGE_TINT = "rgba(168, 85, 247, 0.34)";

export function ClipperWordRangeTranscript({
  words,
  selection,
  onWordClick,
}: {
  words: Array<{ word: WordCue; index: number }>;
  selection: WordRangeSelection;
  onWordClick: (index: number) => void;
}) {
  const { theme, leftScrollbarCss } = useClipperUi();
  const transcriptRef = useRef<HTMLParagraphElement>(null);
  const rangeStart =
    selection.startIdx == null
      ? null
      : selection.endIdx == null
        ? selection.startIdx
        : Math.min(selection.startIdx, selection.endIdx);
  const rangeEnd =
    selection.startIdx == null
      ? null
      : selection.endIdx == null
        ? selection.startIdx
        : Math.max(selection.startIdx, selection.endIdx);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    const nearestIndex = nearestWordIndexFromPointer(
      transcriptRef.current,
      event,
      "data-word-global-index",
    );
    if (nearestIndex == null) return;
    event.preventDefault();
    onWordClick(nearestIndex);
  };

  if (words.length === 0) {
    return <ClipperTranscriptEmpty message="No words in this video window." />;
  }

  return (
    <Box flex="1" minH={0} w="full" overflowY="auto" css={leftScrollbarCss} pr={1} textAlign="left">
      <Text
        ref={transcriptRef}
        fontSize="sm"
        color={theme.text.primary}
        lineHeight="1.8"
        textAlign="left"
        w="full"
        onClick={handleClick}
        aria-label="Click a word to set the clip start or end"
        css={{
          "& [data-word-global-index]": {
            cursor: "pointer",
            borderRadius: 0,
            padding: 0,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
            transition: "background-color 100ms ease-out",
          },
          "& [data-word-global-index][data-in-range='true']": {
            backgroundColor: MANUAL_CLIP_RANGE_TINT,
          },
          "@media (hover: hover)": {
            "& [data-word-global-index]:not([data-in-range='true']):hover": {
              color: clipperTheme.accentLight,
            },
          },
        }}
      >
        {words.map(({ word, index }) => {
          const inRange =
            rangeStart != null && rangeEnd != null && index >= rangeStart && index <= rangeEnd;
          return (
            <span
              key={index}
              data-word-global-index={index}
              data-in-range={inRange ? "true" : undefined}
            >
              {word.text}{" "}
            </span>
          );
        })}
      </Text>
    </Box>
  );
}
