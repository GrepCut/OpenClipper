import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Center, Text } from "@chakra-ui/react";
import { ChevronRight, Trash2 } from "lucide-react";
import { useTheme } from "../../theme";

const COMPLETE_THRESHOLD = 0.85;
const THUMB_SIZE = 40;
const TRACK_HEIGHT = 44;
const TRACK_PADDING = 2;

interface SlideToDeleteControlProps {
  label?: string;
  onComplete: () => Promise<void>;
  disabled?: boolean;
}

export function SlideToDeleteControl({
  label = "Slide to delete",
  onComplete,
  disabled = false,
}: SlideToDeleteControlProps) {
  const { theme } = useTheme();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const [dragX, setDragX] = useState(0);
  const [maxDrag, setMaxDrag] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const measureTrack = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const nextMax = Math.max(0, track.clientWidth - THUMB_SIZE - TRACK_PADDING * 2);
    setMaxDrag(nextMax);
    setDragX((current) => Math.min(current, nextMax));
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    measureTrack();

    const resizeObserver = new ResizeObserver(() => {
      measureTrack();
    });
    resizeObserver.observe(track);

    return () => {
      resizeObserver.disconnect();
    };
  }, [measureTrack]);

  const reset = useCallback(() => {
    setDragX(0);
    setIsDragging(false);
  }, []);

  const complete = useCallback(async () => {
    if (disabled || isProcessing) return;
    setIsProcessing(true);
    try {
      await onComplete();
      reset();
    } finally {
      setIsProcessing(false);
    }
  }, [disabled, isProcessing, onComplete, reset]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || isProcessing) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartXRef.current = event.clientX;
      dragStartOffsetRef.current = dragX;
      setIsDragging(true);
    },
    [disabled, dragX, isProcessing],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || disabled || isProcessing) return;
      const delta = event.clientX - dragStartXRef.current;
      const next = Math.max(0, Math.min(maxDrag, dragStartOffsetRef.current + delta));
      setDragX(next);
    },
    [disabled, isDragging, isProcessing, maxDrag],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setIsDragging(false);

      const progress = maxDrag > 0 ? dragX / maxDrag : 0;
      if (progress >= COMPLETE_THRESHOLD) {
        setDragX(maxDrag);
        void complete();
        return;
      }

      reset();
    },
    [complete, dragX, isDragging, maxDrag, reset],
  );

  const progress = maxDrag > 0 ? dragX / maxDrag : 0;
  const isDisabled = disabled || isProcessing;

  return (
    <Box
      ref={trackRef}
      w="full"
      minW={0}
      position="relative"
      h={`${TRACK_HEIGHT}px`}
      borderRadius="full"
      border="1px solid"
      borderColor={isDisabled ? theme.border.secondary : "rgba(239, 68, 68, 0.45)"}
      bg={isDisabled ? theme.background.tertiary : "rgba(239, 68, 68, 0.1)"}
      overflow="hidden"
      opacity={isDisabled ? 0.55 : 1}
      userSelect="none"
      touchAction="none"
    >
      <Box
        position="absolute"
        inset={`${TRACK_PADDING}px`}
        borderRadius="full"
        bg={`rgba(239, 68, 68, ${0.08 + progress * 0.18})`}
        pointerEvents="none"
      />

      <Center h="full" px={`${THUMB_SIZE + 12}px`} pointerEvents="none">
        <Text
          fontSize="xs"
          fontWeight="semibold"
          color={theme.status.danger}
          opacity={1 - progress * 0.85}
          letterSpacing="0.02em"
        >
          {isProcessing ? "Removing..." : label}
        </Text>
      </Center>

      <Box
        position="absolute"
        top={`${TRACK_PADDING}px`}
        left={`${TRACK_PADDING + dragX}px`}
        w={`${THUMB_SIZE}px`}
        h={`${THUMB_SIZE}px`}
        borderRadius="full"
        bg={theme.status.danger}
        boxShadow="0 2px 8px rgba(0, 0, 0, 0.25)"
        display="flex"
        alignItems="center"
        justifyContent="center"
        cursor={isDisabled ? "not-allowed" : isDragging ? "grabbing" : "grab"}
        transition={isDragging ? "none" : "left 0.2s ease"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {progress >= COMPLETE_THRESHOLD ? (
          <Trash2 size={18} color="white" />
        ) : (
          <ChevronRight size={18} color="white" />
        )}
      </Box>
    </Box>
  );
}
