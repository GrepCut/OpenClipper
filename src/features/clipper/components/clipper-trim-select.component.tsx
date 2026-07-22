import React, { useCallback, useRef, useState } from "react";
import { Box, Button, HStack, Slider, Text, VStack } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { CLIPPER_MIN_CLIP_SECONDS } from "../settings/settings.util";
import { formatDurationMmSs } from "../../../shared/utils/time.util";

interface ClipperTrimSelectProps {
  sourceUrl: string;
  sourceDuration: number;
  initialStartSec?: number;
  initialEndSec?: number;
  sourceFileName: string | null;
  onConfirm: (start: number, end: number) => void;
  onCancel: () => void;
}

function formatTime(seconds: number): string {
  return formatDurationMmSs(seconds);
}

export const ClipperTrimSelect: React.FC<ClipperTrimSelectProps> = ({
  sourceUrl,
  sourceDuration,
  initialStartSec,
  initialEndSec,
  sourceFileName,
  onConfirm,
  onCancel,
}) => {
  const { theme, panelShadow } = useClipperUi();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [range, setRange] = useState<[number, number]>(() => {
    if (initialEndSec != null && initialEndSec > (initialStartSec ?? 0)) {
      return [
        Math.max(0, initialStartSec ?? 0),
        Math.min(sourceDuration, initialEndSec),
      ];
    }
    return [0, sourceDuration];
  });

  const rangeLength = range[1] - range[0];
  const estimatedClips = Math.max(1, Math.ceil(rangeLength / 60));

  const scrubTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = t;
  }, []);

  const handleRangeChange = useCallback(
    (value: number[]) => {
      let [start, end] = value;
      if (end - start < CLIPPER_MIN_CLIP_SECONDS) {
        end = Math.min(sourceDuration, start + CLIPPER_MIN_CLIP_SECONDS);
        start = Math.max(0, end - CLIPPER_MIN_CLIP_SECONDS);
      }
      setRange([start, end]);
      scrubTo(start);
    },
    [scrubTo, sourceDuration],
  );

  return (
    <VStack align="stretch" gap={4} w="100%" maxW="768px" mx="auto">
      <Box
        position="relative"
        borderRadius="2xl"
        overflow="hidden"
        w="100%"
        aspectRatio="16 / 9"
        border="1px solid"
        borderColor={theme.surface.hover}
        boxShadow={panelShadow}
      >
        <video
          ref={videoRef}
          src={sourceUrl}
          controls={false}
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
          onLoadedMetadata={() => scrubTo(range[0])}
        />
        {sourceFileName ? (
          <Box
            position="absolute"
            left={0}
            right={0}
            bottom={0}
            px={4}
            py={3}
            bg={`linear-gradient(transparent, ${theme.overlay.modal})`}
            pointerEvents="none"
          >
            <Text
              fontSize="sm"
              fontWeight="semibold"
              color={theme.text.primary}
              lineClamp={2}
              title={sourceFileName}
            >
              {sourceFileName}
            </Text>
            <Text fontSize="xs" color={theme.text.muted} mt={0.5}>
              {formatTime(sourceDuration)}
            </Text>
          </Box>
        ) : null}
      </Box>

      <HStack justify="space-between" flexWrap="wrap" gap={3}>
        <Text fontSize="sm" color={theme.text.distinct}>
          {formatTime(range[0])} – {formatTime(range[1])}
        </Text>
        <Text fontSize="sm" color={clipperTheme.accentLight} fontWeight="semibold">
          {formatTime(rangeLength)} · ~{estimatedClips} clips
        </Text>
      </HStack>

      <Slider.Root
        min={0}
        max={Math.max(sourceDuration, CLIPPER_MIN_CLIP_SECONDS)}
        step={0.1}
        value={range}
        onValueChange={(d) => handleRangeChange(d.value)}
      >
        <Slider.Control>
          <Slider.Track bg={theme.surface.active} borderRadius="full">
            <Slider.Range bg={clipperTheme.accent} />
          </Slider.Track>
          <Slider.Thumb index={0} />
          <Slider.Thumb index={1} />
        </Slider.Control>
      </Slider.Root>

      <HStack justify="center" gap={4} flexWrap="wrap" pt={2}>
        <Button
          size="lg"
          borderRadius="2xl"
          bg={clipperTheme.accent}
          color={theme.text.onBrand}
          px={8}
          _hover={{ bg: clipperTheme.accentHover }}
          onClick={() => onConfirm(range[0], range[1])}
          disabled={rangeLength < CLIPPER_MIN_CLIP_SECONDS}
        >
          Continue with this range
        </Button>
        <Button
          size="lg"
          variant="outline"
          borderRadius="2xl"
          color={theme.brand.purpleText}
          borderColor={theme.surface.elevated}
          _hover={{
            bg: `rgba(${clipperTheme.accentTintRgb},0.14)`,
            borderColor: clipperTheme.accentGlow,
          }}
          onClick={onCancel}
        >
          Choose another video
        </Button>
      </HStack>
    </VStack>
  );
};
