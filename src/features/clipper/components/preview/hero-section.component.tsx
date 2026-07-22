import React from "react";
import { Box, Text } from "@chakra-ui/react";
import { CLIPPER_HERO_PREVIEW_HEIGHT } from "../../shared/formats.util";
import { ClipperFormatCard } from "../clipper-format-card.component";
import type { ClipperPreviewHeroSectionProps } from "./clipper-preview.types";
import { ClipperPreviewPlayOverlay } from "./play-overlay.component";
import { ClipperPreviewTimeline } from "./timeline.component";

export function ClipperPreviewHeroSection({
  videoRef,
  canvasRefs,
  primaryFormat,
  clipSegments,
  clipDuration,
  activeClipIndex,
  sourceFileName,
  theme,
  onTogglePlay,
}: ClipperPreviewHeroSectionProps) {
  return (
    <Box
      minW={0}
      minH={0}
      w={{ lg: "42%" }}
      display="flex"
      flexDirection="column"
      alignItems={{ lg: "center" }}
      gap={3}
    >
      {sourceFileName ? (
        <Text
          fontSize="2xl"
          fontWeight="bold"
          color={theme.text.primary}
          lineClamp={2}
          w="full"
        >
          {sourceFileName}
        </Text>
      ) : null}
      {primaryFormat ? (
        <ClipperFormatCard
          formatId={primaryFormat.id}
          platform={primaryFormat.platform}
          label={primaryFormat.label}
          frameHeight={CLIPPER_HERO_PREVIEW_HEIGHT}
          footer={
            <ClipperPreviewTimeline
              videoRef={videoRef}
              segments={clipSegments}
              clipDuration={clipDuration}
              activeClipIndex={activeClipIndex}
            />
          }
        >
          <canvas
            ref={(el) => {
              canvasRefs.current[primaryFormat.id] = el;
            }}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
          <ClipperPreviewPlayOverlay
            videoRef={videoRef}
            activeClipIndex={activeClipIndex}
            onTogglePlay={onTogglePlay}
          />
        </ClipperFormatCard>
      ) : null}
    </Box>
  );
}
