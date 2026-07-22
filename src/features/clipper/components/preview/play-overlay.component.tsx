import React, { useEffect, useState } from "react";
import { Box } from "@chakra-ui/react";
import { Pause, Play } from "lucide-react";
import type { ClipperPreviewPlayOverlayProps } from "./clipper-preview.types";

/**
 * Półprzezroczysty przycisk play/pause na środku klipu hero.
 * Cała powierzchnia klipu jest klikalna (toggle), sam krążek jest
 * "lekko widoczny" — mocniejszy gdy zapauzowane, subtelny podczas odtwarzania.
 */
export const ClipperPreviewPlayOverlay = React.memo(function ClipperPreviewPlayOverlay({
  videoRef,
  activeClipIndex,
  onTogglePlay,
}: ClipperPreviewPlayOverlayProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setIsPlaying(!video.paused && !video.ended);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    sync();
    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("ended", sync);
    };
  }, [videoRef, activeClipIndex]);

  return (
    <Box
      as="button"
      type="button"
      position="absolute"
      inset={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="transparent"
      border="none"
      cursor="pointer"
      zIndex={2}
      aria-label={isPlaying ? "Pause" : "Play"}
      onClick={onTogglePlay}
      _hover={{
        "& [data-play-overlay-btn]": { opacity: 1, transform: "scale(1.06)" },
      }}
    >
      <Box
        data-play-overlay-btn
        w="56px"
        h="56px"
        borderRadius="full"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="rgba(0, 0, 0, 0.45)"
        backdropFilter="blur(6px)"
        border="1px solid rgba(255, 255, 255, 0.25)"
        color="white"
        opacity={isPlaying ? 0.3 : 0.75}
        transition="opacity 0.2s ease, transform 0.2s ease"
      >
        {isPlaying ? (
          <Pause size={22} fill="currentColor" />
        ) : (
          <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
        )}
      </Box>
    </Box>
  );
});
