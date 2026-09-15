import type { ReactNode } from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import { aspectRatioFromId } from "../lib/media/video-draw.util";
import {
  getClipperFormatDef,
  type ClipperAspectPresetId,
} from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

const PREVIEW_HEIGHT = "min(calc(85vh - 9rem), 640px)";
const FALLBACK_ASPECT: ClipperAspectPresetId = "9-16";

function cssAspectRatio(aspectId: ClipperAspectPresetId): string {
  return aspectId.replace("-", " / ");
}

function previewAspectId(result: ClipperFormatResult | null): ClipperAspectPresetId {
  return getClipperFormatDef(result?.formatId ?? "")?.aspectId ?? FALLBACK_ASPECT;
}

export function ClipperSocialPublishPreview({
  result,
}: {
  result: ClipperFormatResult | null;
}) {
  const { theme } = useClipperUi();
  const aspectId = previewAspectId(result);
  const cssAspect = cssAspectRatio(aspectId);
  const isVertical = aspectRatioFromId(aspectId) < 1;

  const frameProps = {
    flexShrink: 0,
    alignSelf: { base: "center" as const, lg: isVertical ? ("stretch" as const) : ("center" as const) },
    h: { base: "auto" as const, lg: isVertical ? "100%" : "auto" },
    w: {
      base: isVertical ? "min(100%, 280px)" : "full",
      lg: isVertical ? "auto" : "min(100%, 560px)",
    },
    maxH: { lg: "100%" },
    maxW: "100%",
    aspectRatio: cssAspect,
    borderRadius: "xl",
    overflow: "hidden",
  };

  if (!result?.previewUrl) {
    return (
      <Box
        {...frameProps}
        minH={{ base: isVertical ? "320px" : "180px", lg: isVertical ? undefined : "180px" }}
        bg={theme.surface.subtle}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text fontSize="sm" color={theme.text.muted}>
          No preview available
        </Text>
      </Box>
    );
  }

  return (
    <Box {...frameProps}>
      <video
        controls
        src={result.previewUrl}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </Box>
  );
}

export function ClipperSocialPublishTwoColumn({
  result,
  children,
}: {
  result: ClipperFormatResult | null;
  children: ReactNode;
}) {
  return (
    <HStack
      w="full"
      align="stretch"
      gap={5}
      h={{ base: "auto", lg: PREVIEW_HEIGHT }}
      minH={0}
      flexDirection={{ base: "column", lg: "row" }}
    >
      <ClipperSocialPublishPreview result={result} />
      {children}
    </HStack>
  );
}
