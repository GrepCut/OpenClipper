import React, { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

const PUBLISH_ROW_THUMB_SIZE = 72;

interface ClipperPublishExportThumbProps {
  clipIndex: number;
  thumbnail?: HTMLCanvasElement;
  onPreview: () => void;
}

export function ClipperPublishExportThumb({
  clipIndex,
  thumbnail,
  onPreview,
}: ClipperPublishExportThumbProps) {
  const { theme } = useClipperUi();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!thumbnail) return;

    thumbnail.style.width = "100%";
    thumbnail.style.height = "100%";
    thumbnail.style.objectFit = "cover";
    thumbnail.style.display = "block";
    host.appendChild(thumbnail);

    return () => {
      if (thumbnail.parentNode === host) host.removeChild(thumbnail);
    };
  }, [thumbnail]);

  return (
    <Box
      asChild
      position="relative"
      flexShrink={0}
      w={`${PUBLISH_ROW_THUMB_SIZE}px`}
      h={`${PUBLISH_ROW_THUMB_SIZE}px`}
      borderRadius="lg"
      overflow="hidden"
      bg={theme.background.surface}
      border="1px solid"
      borderColor={theme.surface.hover}
      cursor="pointer"
      p={0}
    >
      <button type="button" onClick={onPreview} aria-label={`Preview clip ${clipIndex + 1}`}>
        <Box ref={hostRef} w="100%" h="100%" />
        <Box
          position="absolute"
          inset={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
          bg="rgba(0, 0, 0, 0.22)"
        >
          <Box
            w="28px"
            h="28px"
            borderRadius="md"
            bg="rgba(0, 0, 0, 0.48)"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Box
              w="0"
              h="0"
              ml="2px"
              borderTop="6px solid transparent"
              borderBottom="6px solid transparent"
              borderLeft="10px solid rgba(255, 255, 255, 0.92)"
            />
          </Box>
        </Box>
      </button>
    </Box>
  );
}
