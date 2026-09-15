import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, useBreakpointValue } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  clampClipperPublishPanelWidth,
  useClipperPublishSplitStore,
} from "../shared/use-clipper-publish-split.store";
import { PublishSplitHandle } from "./clipper-publish-split-handle.component";

interface ClipperPublishSplitLayoutProps {
  graph: React.ReactNode;
  detail: React.ReactNode;
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

  return (
    <Box
      ref={containerRef}
      display="flex"
      flex="1"
      minH={0}
      flexWrap={isResizable ? "nowrap" : "wrap"}
      gap={isResizable ? 0 : 4}
      borderRadius="2xl"
      border={isResizable ? "1px solid" : "none"}
      borderColor={theme.border.primary}
      bg={isResizable ? theme.background.card : undefined}
      overflow={isResizable ? "hidden" : undefined}
      userSelect={isDragging ? "none" : undefined}
    >
      <Box
        flex="1"
        minW={isResizable ? 0 : "full"}
        minH={isResizable ? 0 : "320px"}
        position="relative"
      >
        {graph}
        {isResizable ? (
          <PublishSplitHandle
            isDragging={isDragging}
            panelWidth={panelWidth}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onResizeBy={handleResizeBy}
          />
        ) : null}
      </Box>

      <Box
        w={isResizable ? `${panelWidth}px` : undefined}
        flex={isResizable ? undefined : "1"}
        flexShrink={isResizable ? 0 : undefined}
        minW={isResizable ? undefined : "full"}
        h={isResizable ? "full" : undefined}
        minH={0}
        display="flex"
        flexDirection="column"
        borderLeft={isResizable ? "1px solid" : undefined}
        borderColor={theme.border.primary}
        overflow="hidden"
      >
        {detail}
      </Box>
    </Box>
  );
}
