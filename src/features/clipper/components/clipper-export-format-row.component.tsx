import React from "react";
import { Box, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, Facebook, FolderOpen, RotateCcw } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { CLIPPER_FORMAT_DEFS, getClipperCardFrameSize } from "../shared/formats.util";
import { formatBytes } from "../shared/logger.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

export type ClipperPublishTarget = "facebook" | "instagram" | "tiktok" | "youtube" | "x";

const THUMB_HEIGHT = 144;
const PLATFORM_ICON_SIZE = 28;
const PREVIEW_COLUMN_WIDTH = Math.max(
  ...CLIPPER_FORMAT_DEFS.map((def) => getClipperCardFrameSize(def.id, THUMB_HEIGHT).width),
);
/** Wide enough for the publishing action labels at sm + 16px icon without clipping. */
const ACTIONS_COLUMN_WIDTH = 232;

interface ClipperExportFormatRowProps {
  result: ClipperFormatResult;
  isRerendering: boolean;
  showRerender?: boolean;
  onOpenFolder: () => void;
  onPublish: (result: ClipperFormatResult, target: ClipperPublishTarget) => void;
  onRerender: (formatId: string, clipIndex: number) => void;
}

function formatExportedAt(exportedAt: string): string {
  const date = new Date(exportedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export const ClipperExportFormatRow: React.FC<ClipperExportFormatRowProps> = ({
  result,
  isRerendering,
  showRerender = false,
  onOpenFolder,
  onPublish,
  onRerender,
}) => {
  const { theme } = useClipperUi();
  const frame = getClipperCardFrameSize(result.formatId, THUMB_HEIGHT);
  const isMissing = result.isMissing === true;
  const exportedAtLabel = formatExportedAt(result.exportedAt);
  const clipLabel = `Clip ${result.clipIndex + 1}`;

  return (
    <HStack
      align="center"
      gap={4}
      p={4}
      borderRadius="xl"
      border="1px solid"
      borderColor={theme.surface.hover}
      bg={theme.surface.faint}
      flexWrap={{ base: "wrap", lg: "nowrap" }}
    >
      <Flex
        flexShrink={0}
        w={{ base: "full", lg: `${PREVIEW_COLUMN_WIDTH}px` }}
        minW={{ lg: `${PREVIEW_COLUMN_WIDTH}px` }}
        justify="center"
        align="center"
      >
        <Box
          w={`${frame.width}px`}
          h={`${frame.height}px`}
          borderRadius="lg"
          overflow="hidden"
          bg={theme.background.surface}
          border="1px solid"
          borderColor={theme.surface.hover}
        >
          {isMissing ? (
            <Flex
              direction="column"
              align="center"
              justify="center"
              w="full"
              h="full"
              gap={2}
              px={3}
              color={theme.text.muted}
            >
              <AlertTriangle size={24} />
              <Text fontSize="xs" fontWeight="semibold" textAlign="center">
                Lost media
              </Text>
            </Flex>
          ) : (
            <video
              src={result.previewUrl}
              controls
              playsInline
              preload="metadata"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
        </Box>
      </Flex>

      <HStack align="center" gap={2} flex={1} minW={0}>
        <Flex
          w={`${PLATFORM_ICON_SIZE}px`}
          minW={`${PLATFORM_ICON_SIZE}px`}
          h={`${PLATFORM_ICON_SIZE}px`}
          align="center"
          justify="center"
          flexShrink={0}
        >
          <ClipperPlatformIcon platform={result.platform} size={PLATFORM_ICON_SIZE} />
        </Flex>
        <VStack align="start" gap={1} flex={1} minW={0}>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} lineClamp={1}>
            {result.label}
          </Text>
          <Text fontSize="xs" color={theme.text.muted}>
            {clipLabel}
            {isMissing ? " · Lost media" : ""}
            {" · "}
            {result.width}×{result.height} · {formatBytes(result.fileSize)}
          </Text>
          {exportedAtLabel ? (
            <Text fontSize="xs" color={theme.text.muted}>
              Exported {exportedAtLabel}
            </Text>
          ) : null}
        </VStack>
      </HStack>

      <VStack
        align="stretch"
        gap={2}
        flexShrink={0}
        w={{ base: "full", lg: `${ACTIONS_COLUMN_WIDTH}px` }}
        minW={{ lg: `${ACTIONS_COLUMN_WIDTH}px` }}
      >
        <OutlinedActionButton
          width="100%"
          justifyContent="center"
          whiteSpace="nowrap"
          startIcon={<FolderOpen size={16} />}
          onClick={onOpenFolder}
          disabled={isMissing}
        >
          Open folder
        </OutlinedActionButton>
        <OutlinedActionButton
          width="100%"
          justifyContent="center"
          whiteSpace="nowrap"
          startIcon={<ClipperPlatformIcon platform="tiktok" size={16} />}
          onClick={() => onPublish(result, "tiktok")}
          disabled={isMissing}
        >
          Publish to TikTok
        </OutlinedActionButton>
        <OutlinedActionButton
          width="100%"
          justifyContent="center"
          whiteSpace="nowrap"
          startIcon={<ClipperPlatformIcon platform="youtube" size={16} />}
          onClick={() => onPublish(result, "youtube")}
          disabled={isMissing}
        >
          Publish to YouTube
        </OutlinedActionButton>
        <OutlinedActionButton
          width="100%"
          justifyContent="center"
          whiteSpace="nowrap"
          startIcon={<ClipperPlatformIcon platform="twitter" size={16} />}
          onClick={() => onPublish(result, "x")}
          disabled={isMissing}
        >
          Publish to X
        </OutlinedActionButton>
        <OutlinedActionButton width="100%" justifyContent="center" whiteSpace="nowrap"
          startIcon={<ClipperPlatformIcon platform="instagram" size={16} />}
          onClick={() => onPublish(result, "instagram")} disabled={isMissing}>
          Publish to Instagram
        </OutlinedActionButton>
        <OutlinedActionButton width="100%" justifyContent="center" whiteSpace="nowrap"
          startIcon={<Facebook size={16} />}
          onClick={() => onPublish(result, "facebook")} disabled={isMissing}>
          Publish to Facebook
        </OutlinedActionButton>
        {showRerender ? (
          <OutlinedActionButton
            width="100%"
            justifyContent="center"
            startIcon={<RotateCcw size={16} />}
            loading={isRerendering}
            onClick={() => onRerender(result.formatId, result.clipIndex)}
            disabled={isMissing}
          >
            Re-render
          </OutlinedActionButton>
        ) : null}
      </VStack>
    </HStack>
  );
};
