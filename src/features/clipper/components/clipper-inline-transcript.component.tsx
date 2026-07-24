import React, { useMemo } from "react";
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
    let index = words.findIndex((w) => w.end + wordTimeOffsetSec > region.start);
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
  return regions.filter((region) => region.end > clipStartSec && region.start < clipEndSec);
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

export const ClipperInlineTranscript: React.FC<ClipperInlineTranscriptProps> = ({
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
  const disabledSet = useMemo(() => new Set(disabledRegionIds), [disabledRegionIds]);
  const markersByWordIndex = useMemo(
    () => (showCollageMarkers ? regionsByWordIndex(words, regions, wordTimeOffsetSec) : new Map<number, CollageRegion[]>()),
    [words, regions, wordTimeOffsetSec, showCollageMarkers],
  );

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
    <Text fontSize="sm" color={theme.text.onBrandMuted} lineHeight="1.8">
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
              <Box
                as="span"
                role="button"
                tabIndex={0}
                cursor="pointer"
                borderRadius="sm"
                px={0.5}
                mx={-0.5}
                _hover={{
                  color: clipperTheme.accentLight,
                  textDecoration: "underline",
                  bg: `rgba(${clipperTheme.accentTintRgb},0.12)`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onWordClick(wordAbsoluteTimeSec(word, wordTimeOffsetSec));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onWordClick(wordAbsoluteTimeSec(word, wordTimeOffsetSec));
                  }
                }}
              >
                {word.text}
              </Box>
            ) : (
              word.text
            )}{" "}
          </React.Fragment>
        );
      })}
    </Text>
  );
};
