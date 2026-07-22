import React from "react";
import { Box } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { CLIPS_LIST_FADE_HEIGHT } from "./clipper-clips-section.types";

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
      bg={`linear-gradient(to top, ${theme.background.primary} 0%, transparent 100%)`}
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
}: {
  children: React.ReactNode;
  fadeBottom?: number | string;
  showBottomFade?: boolean;
  fadeHeight?: number | string;
  contentPaddingBottom?: number | string;
  css: Record<string, unknown>;
}) {
  return (
    <Box position="relative" flex="1" minH={0}>
      <Box position="absolute" inset={0} css={css}>
        <Box css={{ direction: "ltr", minHeight: "100%" }} pb={contentPaddingBottom}>
          {children}
        </Box>
      </Box>
      {showBottomFade ? <ClipsListBottomFade bottom={fadeBottom} height={fadeHeight} /> : null}
    </Box>
  );
}
