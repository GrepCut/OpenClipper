import React, { useCallback, useState } from "react";
import { Box, Center } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  CLIPPER_PUBLISH_PANEL_MAX_WIDTH,
  CLIPPER_PUBLISH_PANEL_MIN_WIDTH,
} from "../shared/use-clipper-publish-split.store";

interface PublishSplitHandleProps {
  isDragging: boolean;
  panelWidth: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeBy: (delta: number) => void;
}

export function PublishSplitHandle({
  isDragging,
  panelWidth,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResizeBy,
}: PublishSplitHandleProps) {
  const { theme } = useClipperUi();
  const [isHovered, setIsHovered] = useState(false);
  const isActive = isDragging || isHovered;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onResizeBy(16);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onResizeBy(-16);
      }
    },
    [onResizeBy],
  );

  return (
    <Center
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize detail panel"
      aria-valuemin={CLIPPER_PUBLISH_PANEL_MIN_WIDTH}
      aria-valuemax={CLIPPER_PUBLISH_PANEL_MAX_WIDTH}
      aria-valuenow={panelWidth}
      tabIndex={0}
      position="absolute"
      top={0}
      bottom={0}
      right={0}
      transform="translateX(50%)"
      zIndex={2}
      w="14px"
      cursor="col-resize"
      touchAction="none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      _focusVisible={{
        outline: "none",
        "& [data-split-grip]": {
          boxShadow: `0 0 0 2px ${theme.brand.toggleActiveBorder}`,
          opacity: 1,
        },
      }}
    >
      <Box
        data-split-grip
        position="relative"
        zIndex={1}
        w={isActive ? "5px" : "4px"}
        h={isActive ? "72px" : "52px"}
        borderRadius="full"
        border="1px solid"
        borderColor={isActive ? theme.brand.toggleActiveBorder : theme.border.primary}
        bg={isActive ? theme.brand.toggleActiveBg : theme.background.tertiary}
        opacity={isActive ? 1 : 0.82}
        boxShadow={
          isDragging
            ? `0 0 0 4px ${theme.brand.purpleSoftAlpha12}`
            : isHovered
              ? theme.shadow.toolbar
              : "none"
        }
        transition="width 0.18s ease, height 0.18s ease, border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease"
        pointerEvents="none"
      >
        <Center h="full" gap="3px" flexDirection="column">
          {[0, 1, 2].map((index) => (
            <Box
              key={index}
              w="2px"
              h="2px"
              borderRadius="full"
              bg={isActive ? theme.brand.purpleSoft : theme.text.muted}
              opacity={isActive ? 0.95 : 0.55}
            />
          ))}
        </Center>
      </Box>
    </Center>
  );
}
