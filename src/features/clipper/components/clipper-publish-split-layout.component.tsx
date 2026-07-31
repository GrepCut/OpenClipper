import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Center, HStack, useBreakpointValue } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  CLIPPER_PUBLISH_PANEL_MAX_WIDTH,
  CLIPPER_PUBLISH_PANEL_MIN_WIDTH,
  clampClipperPublishPanelWidth,
  useClipperPublishSplitStore,
} from "../shared/use-clipper-publish-split.store";

interface ClipperPublishSplitLayoutProps {
  graph: React.ReactNode;
  detail: React.ReactNode;
}

interface PublishSplitHandleProps {
  isDragging: boolean;
  panelWidth: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeBy: (delta: number) => void;
}

function PublishSplitHandle({
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

export function ClipperPublishSplitLayout({ graph, detail }: ClipperPublishSplitLayoutProps) {
  const { theme } = useClipperUi();
  const isResizable = useBreakpointValue({ base: false, lg: true }) ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const panelWidthPx = useClipperPublishSplitStore((state) => state.panelWidthPx);
  const setPanelWidthPx = useClipperPublishSplitStore((state) => state.setPanelWidthPx);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const panelWidth = liveWidth ?? panelWidthPx;

  const commitWidth = useCallback(
    (width: number) => {
      const containerWidth = containerRef.current?.clientWidth;
      const nextWidth = clampClipperPublishPanelWidth(width, containerWidth);
      setLiveWidth(null);
      setPanelWidthPx(nextWidth);
    },
    [setPanelWidthPx],
  );

  const scheduleWidthUpdate = useCallback((width: number) => {
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const containerWidth = containerRef.current?.clientWidth;
      setLiveWidth(clampClipperPublishPanelWidth(width, containerWidth));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isDragging]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizable) return;
      event.preventDefault();
      dragStateRef.current = {
        startX: event.clientX,
        startWidth: panelWidth,
      };
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isResizable, panelWidth],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = dragState.startX - event.clientX;
      scheduleWidthUpdate(dragState.startWidth + delta);
    },
    [scheduleWidthUpdate],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      dragStateRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const delta = dragState.startX - event.clientX;
      commitWidth(dragState.startWidth + delta);
    },
    [commitWidth],
  );

  const handleResizeBy = useCallback(
    (delta: number) => {
      commitWidth(panelWidth + delta);
    },
    [commitWidth, panelWidth],
  );

  if (!isResizable) {
    return (
      <HStack align="stretch" gap={4} flex="1" minH={0} flexWrap="wrap">
        <Box flex="1" minW="full" minH={0}>
          {graph}
        </Box>
        <Box flex="1" minW="full" minH={0}>
          {detail}
        </Box>
      </HStack>
    );
  }

  return (
    <Box
      ref={containerRef}
      display="flex"
      flex="1"
      minH={0}
      borderRadius="2xl"
      border="1px solid"
      borderColor={theme.border.primary}
      bg={theme.background.card}
      overflow="hidden"
      userSelect={isDragging ? "none" : undefined}
    >
      <Box flex="1" minW={0} minH={0} position="relative">
        {graph}
        <PublishSplitHandle
          isDragging={isDragging}
          panelWidth={panelWidth}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onResizeBy={handleResizeBy}
        />
      </Box>

      <Box
        w={`${panelWidth}px`}
        flexShrink={0}
        minH={0}
        borderLeft="1px solid"
        borderColor={theme.border.primary}
        overflow="hidden"
      >
        {detail}
      </Box>
    </Box>
  );
}
