import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Flex, IconButton } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui";

const DRAG_THRESHOLD_PX = 4;

interface ClipperHorizontalCarouselProps {
  children: React.ReactNode;
  gap?: number;
  align?: "flex-start" | "flex-end" | "center";
  justify?: "flex-start" | "center";
}

export const ClipperHorizontalCarousel: React.FC<ClipperHorizontalCarouselProps> = ({
  children,
  gap = 4,
  align = "flex-end",
  justify = "flex-start",
}) => {
  const { theme, hiddenScrollbarCss } = useClipperUi();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
  });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollState();
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    el.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateScrollState);
    };
  }, [children, updateScrollState]);

  const scrollByAmount = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(220, el.clientWidth * 0.65), behavior: "smooth" });
  };

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element && target.closest("button, a, input, textarea, video, [data-no-drag]");

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isInteractiveTarget(e.target)) return;

    const el = scrollRef.current;
    if (!el) return;

    dragRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      scrollLeft: el.scrollLeft,
    };
    setIsDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;

    const el = scrollRef.current;
    if (!el) return;

    const dx = e.clientX - dragRef.current.startX;
    if (!dragRef.current.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;

    dragRef.current.moved = true;
    el.scrollLeft = dragRef.current.scrollLeft - dx;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;

    const el = scrollRef.current;
    if (el && dragRef.current.pointerId === e.pointerId) {
      el.releasePointerCapture(e.pointerId);
    }

    dragRef.current.active = false;
    setIsDragging(false);
  };

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.moved = false;
    }
  };

  const scrollable = canScrollLeft || canScrollRight;

  return (
    <Box position="relative" w="100%">
      <Flex
        ref={scrollRef}
        direction="row"
        gap={gap}
        align={align}
        justify={justify}
        flexWrap="nowrap"
        overflowX="auto"
        w="100%"
        pt={1}
        pb={2}
        cursor={isDragging ? "grabbing" : scrollable ? "grab" : "default"}
        touchAction="pan-x"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        css={{
          ...hiddenScrollbarCss,
          userSelect: isDragging ? "none" : undefined,
        }}
      >
        {children}
      </Flex>

      {canScrollLeft ? (
        <IconButton
          aria-label="Scroll left"
          position="absolute"
          left={1}
          top="50%"
          transform="translateY(-50%)"
          zIndex={2}
          size="sm"
          variant="ghost"
          borderRadius="full"
          bg={theme.background.surface}
          border="1px solid"
          borderColor={theme.surface.hover}
          boxShadow={theme.shadow.panel}
          color={theme.text.muted}
          onClick={() => scrollByAmount(-1)}
          _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
        >
          <ChevronLeft size={18} />
        </IconButton>
      ) : null}

      {canScrollRight ? (
        <IconButton
          aria-label="Scroll right"
          position="absolute"
          right={1}
          top="50%"
          transform="translateY(-50%)"
          zIndex={2}
          size="sm"
          variant="ghost"
          borderRadius="full"
          bg={theme.background.surface}
          border="1px solid"
          borderColor={theme.surface.hover}
          boxShadow={theme.shadow.panel}
          color={theme.text.muted}
          onClick={() => scrollByAmount(1)}
          _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
        >
          <ChevronRight size={18} />
        </IconButton>
      ) : null}
    </Box>
  );
};
