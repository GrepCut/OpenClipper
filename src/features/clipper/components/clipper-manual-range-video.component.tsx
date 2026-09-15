import React from "react";
import { Box, Slider, Text, VStack } from "@chakra-ui/react";
import { Pause, Play } from "lucide-react";
import type { ManualClipPlaybackMode } from "../hooks/use-clipper-manual-clip-range.hook";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export function ClipperManualRangeVideo({
  videoRef,
  canvasPreview,
  videoUrl,
  durationSec,
  playbackMode,
  clipTimeRange,
  currentTimeSec,
  isPlaying,
  onTogglePlay,
  onClipTimeChange,
  onPlayheadChange,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  canvasPreview?: {
    formatId: string;
    registerCanvas: (formatId: string, canvas: HTMLCanvasElement | null) => void;
  } | null;
  videoUrl: string | null;
  durationSec: number;
  playbackMode: ManualClipPlaybackMode;
  clipTimeRange: [number, number];
  currentTimeSec: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onClipTimeChange: (value: number[]) => void;
  onPlayheadChange: (value: number[]) => void;
}) {
  const { theme, panelShadow } = useClipperUi();
  const sliderMax = Math.max(durationSec, 1);

  return (
    <VStack align="center" gap={3} w="full" h="full" minH={0} flex="1">
      <Box
        className="group"
        position="relative"
        borderRadius="2xl"
        overflow="hidden"
        flex="1"
        minH={0}
        h="100%"
        w="auto"
        maxW="full"
        aspectRatio="9 / 16"
        alignSelf="center"
        border="1px solid"
        borderColor={theme.border.primary}
        boxShadow={panelShadow}
        bg={theme.background.tertiary}
      >
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              controls={false}
              playsInline
              aria-hidden={canvasPreview ? true : undefined}
              style={
                canvasPreview
                  ? {
                      position: "absolute",
                      width: "1px",
                      height: "1px",
                      opacity: 0,
                      pointerEvents: "none",
                    }
                  : {
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }
              }
            />
            {canvasPreview ? (
              <canvas
                ref={(el) => {
                  canvasPreview.registerCanvas(canvasPreview.formatId, el);
                }}
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            ) : null}
          </>
        ) : (
          <Box
            position="absolute"
            inset={0}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Text fontSize="sm" color={theme.text.muted}>
              Video preview unavailable
            </Text>
          </Box>
        )}
        <Box
          asChild
          position="absolute"
          inset={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={onTogglePlay}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <Box
              w="48px"
              h="48px"
              borderRadius="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
              bg="rgba(0, 0, 0, 0.45)"
              color="white"
              opacity={isPlaying ? 0 : 1}
              transition="opacity 0.15s ease"
              _groupHover={{ opacity: 1 }}
            >
              {isPlaying ? <Pause size={22} /> : <Play size={22} />}
            </Box>
          </button>
        </Box>
      </Box>

      <Box w="full" maxW="full" flexShrink={0} px={1}>
        {playbackMode === "select" ? (
          <Slider.Root
            min={0}
            max={sliderMax}
            step={0.1}
            value={clipTimeRange}
            onValueChange={(details) => onClipTimeChange(details.value)}
          >
            <Slider.Control>
              <Slider.Track bg={theme.surface.active} borderRadius="full">
                <Slider.Range bg={clipperTheme.accent} />
              </Slider.Track>
              <Slider.Thumb index={0} />
              <Slider.Thumb index={1} />
            </Slider.Control>
          </Slider.Root>
        ) : (
          <Slider.Root
            min={0}
            max={sliderMax}
            step={0.1}
            value={[currentTimeSec]}
            onValueChange={(details) => onPlayheadChange(details.value)}
          >
            <Slider.Control>
              <Slider.Track bg={theme.surface.active} borderRadius="full">
                <Slider.Range bg={clipperTheme.accent} />
              </Slider.Track>
              <Slider.Thumb index={0} />
            </Slider.Control>
          </Slider.Root>
        )}
      </Box>
    </VStack>
  );
}
