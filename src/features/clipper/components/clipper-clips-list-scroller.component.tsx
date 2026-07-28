import React, { useCallback } from "react";
import { Box } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { CLIPS_LIST_FADE_HEIGHT } from "./clipper-clips-section.types";

function scrollScrollableAncestor(from: HTMLElement, deltaY: number): boolean {
  let node: HTMLElement | null = from.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      node.scrollTop += deltaY;
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function forwardWheelToScrollableParent(event: React.WheelEvent<HTMLElement>) {
  const el = event.currentTarget;
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop >= maxScroll - 1;
  const scrollingUp = event.deltaY < 0;
  const scrollingDown = event.deltaY > 0;
  const canScrollInternally =
    maxScroll > 1 && ((scrollingUp && !atTop) || (scrollingDown && !atBottom));

  if (canScrollInternally) return;

  if (scrollScrollableAncestor(el, event.deltaY)) {
    event.preventDefault();
  }
}

function ClipsListBottomFade({
  bottom = 0,
  height = CLIPS_LIST_FADE_HEIGHT,
}: {
  bottom?: number | string;
  height?: number | string;
}) {
  const { theme } = useClipperUi();

  return (
    <Box
      position="absolute"
      bottom={bottom}
      left={0}
      right={0}
      h={height}
      pointerEvents="none"
      zIndex={1}
      bg={`linear-gradient(to top, ${theme.background.card} 0%, transparent 100%)`}
    />
  );
}

export function ClipsListScroller({
  children,
  fadeBottom = 0,
  showBottomFade = true,
  fadeHeight = CLIPS_LIST_FADE_HEIGHT,
  contentPaddingBottom,
  css,
  scrollRef,
}: {
  children: React.ReactNode;
  fadeBottom?: number | string;
  showBottomFade?: boolean;
  fadeHeight?: number | string;
  contentPaddingBottom?: number | string;
  css: Record<string, unknown>;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    forwardWheelToScrollableParent(event);
  }, []);

  return (
    <Box position="relative" flex="1" minH={0}>
      <Box ref={scrollRef} position="absolute" inset={0} css={css} onWheel={handleWheel}>
        <Box css={{ direction: "ltr", minHeight: "100%" }} pb={contentPaddingBottom}>
          {children}
        </Box>
      </Box>
      {showBottomFade ? <ClipsListBottomFade bottom={fadeBottom} height={fadeHeight} /> : null}
    </Box>
  );
}
