import React, { useMemo, useRef } from "react";
import { Box, IconButton, Text } from "@chakra-ui/react";
import { Columns2 } from "lucide-react";
import type { CollageRegion } from "../engine/types/collage.types";
import type { WordCue } from "../lib/media/transcription-export.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { clipperTheme } from "../shared/theme.util";
import { ClipperTranscriptEmpty } from "./clipper-transcript-empty.component";

export interface ClipperInlineTranscriptProps {
  words: WordCue[];
  /** Absolutny offset czasu słów względem range (np. clip.startSec lub 0 dla rangeWords). */
  wordTimeOffsetSec: number;
  regions: CollageRegion[];
  disabledRegionIds: string[];
  onToggleRegion: (regionId: string) => void;
  showCollageMarkers?: boolean;
  emptyMessage?: string;
  onWordClick?: (absoluteTimeSec: number) => void;
}

function wordAbsoluteTimeSec(word: WordCue, wordTimeOffsetSec: number): number {
  return word.start + wordTimeOffsetSec;
}

/** Maps each region to the first word it overlaps, so its marker renders inline at the right spot. */
function regionsByWordIndex(
  words: WordCue[],
  regions: CollageRegion[],
  wordTimeOffsetSec = 0,
): Map<number, CollageRegion[]> {
  const map = new Map<number, CollageRegion[]>();
  for (const region of regions) {
    let index = words.findIndex(
      (w) => w.end + wordTimeOffsetSec > region.start,
    );
    if (index === -1) index = Math.max(0, words.length - 1);
    const existing = map.get(index);
    if (existing) existing.push(region);
    else map.set(index, [region]);
  }
  return map;
}

export function filterRegionsForClip(
  regions: CollageRegion[],
  clipStartSec: number,
  clipEndSec: number,
): CollageRegion[] {
  return regions.filter(
    (region) => region.end > clipStartSec && region.start < clipEndSec,
  );
}

export function sliceWordsForTimeWindow(
  words: WordCue[],
  startSec: number,
  endSec: number,
): WordCue[] {
  return words.filter((word) => word.end > startSec && word.start < endSec);
}

function SplitRegionMarker({
  region,
  enabled,
  onToggle,
  inline,
  onBrand,
  muted,
}: {
  region: CollageRegion;
  enabled: boolean;
  onToggle: (regionId: string) => void;
  inline?: boolean;
  onBrand: string;
  muted: string;
}) {
  return (
    <IconButton
      key={region.id}
      aria-label={
        enabled
          ? "Two speakers detected — split-screen on here. Click to turn off for this part."
          : "Split-screen turned off for this part. Click to turn back on."
      }
      title={
        enabled
          ? "Split-screen on here — click to turn off"
          : "Split-screen off here — click to turn on"
      }
      size="2xs"
      variant={enabled ? "solid" : "outline"}
      bg={enabled ? clipperTheme.accent : undefined}
      color={enabled ? onBrand : muted}
      borderRadius="full"
      w="22px"
      h="22px"
      minW="22px"
      minH="22px"
      p={0}
      flexShrink={0}
      mx={inline ? 1 : undefined}
      verticalAlign={inline ? "middle" : undefined}
      transition="background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease"
      _hover={
        enabled
          ? {
              bg: clipperTheme.accentHover,
              opacity: 0.92,
            }
          : {
              bg: `rgba(${clipperTheme.accentTintRgb},0.12)`,
              borderColor: clipperTheme.accent,
              color: clipperTheme.accentLight,
            }
      }
      onClick={(e) => {
        e.stopPropagation();
        onToggle(region.id);
      }}
    >
      <Columns2 size={12} />
    </IconButton>
  );
}

export const ClipperInlineTranscript: React.FC<
  ClipperInlineTranscriptProps
> = ({
  words,
  wordTimeOffsetSec,
  regions,
  disabledRegionIds,
  onToggleRegion,
  showCollageMarkers = true,
  emptyMessage = "No speech detected in this range.",
  onWordClick,
}) => {
  const { theme } = useClipperUi();
  const disabledSet = useMemo(
    () => new Set(disabledRegionIds),
    [disabledRegionIds],
  );
  const transcriptRef = useRef<HTMLParagraphElement>(null);
  const markersByWordIndex = useMemo(
    () =>
      showCollageMarkers
        ? regionsByWordIndex(words, regions, wordTimeOffsetSec)
        : new Map<number, CollageRegion[]>(),
    [words, regions, wordTimeOffsetSec, showCollageMarkers],
  );
  const handleTranscriptClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!onWordClick) return;

    // Split-screen markers own their clicks. Everything else seeks to the word
    // closest to the pointer, including whitespace between wrapped lines.
    if (event.target instanceof Element && event.target.closest("button"))
      return;

    const wordElements =
      transcriptRef.current?.querySelectorAll<HTMLElement>("[data-word-index]");
    if (!wordElements?.length) return;

    let nearestWordIndex = -1;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const element of wordElements) {
      const index = Number(element.dataset.wordIndex);
      if (!Number.isInteger(index) || !words[index]) continue;

      const rect = element.getBoundingClientRect();
      const deltaX = Math.max(
        rect.left - event.clientX,
        0,
        event.clientX - rect.right,
      );
      const deltaY = Math.max(
        rect.top - event.clientY,
        0,
        event.clientY - rect.bottom,
      );
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestWordIndex = index;
        if (distanceSquared === 0) break;
      }
    }

    if (nearestWordIndex === -1) return;
    event.stopPropagation();
    onWordClick(
      wordAbsoluteTimeSec(words[nearestWordIndex], wordTimeOffsetSec),
    );
  };
  if (words.length === 0) {
    if (!showCollageMarkers || regions.length === 0) {
      return <ClipperTranscriptEmpty message={emptyMessage} />;
    }
    return (
      <Box>
        <ClipperTranscriptEmpty message={emptyMessage} />
        <Box mt={1} display="flex" flexWrap="wrap" gap={1}>
          {regions.map((region) => (
            <SplitRegionMarker
              key={region.id}
              region={region}
              enabled={!disabledSet.has(region.id)}
              onToggle={onToggleRegion}
              onBrand={theme.text.onBrand}
              muted={theme.text.muted}
            />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Text
      ref={transcriptRef}
      fontSize="sm"
      color={theme.text.onBrandMuted}
      lineHeight="1.8"
      onClick={onWordClick ? handleTranscriptClick : undefined}
      aria-label={
        onWordClick ? "Click transcript to seek to the nearest word" : undefined
      }
      css={
        onWordClick
          ? {
              "& [data-word-index]": {
                transition: "color 100ms ease-out",
              },
              "@media (hover: hover)": {
                "& [data-word-index]:hover": {
                  color: clipperTheme.accentLight,
                },
              },
            }
          : undefined
      }
    >
      {words.map((word, index) => {
        const markers = markersByWordIndex.get(index);
        return (
          <React.Fragment key={index}>
            {markers?.map((region) => (
              <SplitRegionMarker
                key={region.id}
                region={region}
                enabled={!disabledSet.has(region.id)}
                onToggle={onToggleRegion}
                inline
                onBrand={theme.text.onBrand}
                muted={theme.text.muted}
              />
            ))}
            {onWordClick ? (
              <span data-word-index={index}>{word.text}</span>
            ) : (
              word.text
            )}{" "}
          </React.Fragment>
        );
      })}
    </Text>
  );
};
