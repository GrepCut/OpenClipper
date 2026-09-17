import React, { useCallback } from "react";
import { Box, Center, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { SlideToDeleteControl } from "../../../shared/components/slide-to-delete-control.component";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { appToast } from "../../../shared/utils/toast.service";
import type { ExportSocialFields } from "../persistence/clipper-export-social.util";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { removeClipperExport } from "../persistence/clipper-export-remove.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";
import { ClipperExportMetadataPanel } from "./clipper-export-metadata-panel.component";
import { ClipperExportRevealButton } from "./clipper-export-reveal-button.component";
import { ClipperPublishDetailStatus } from "./clipper-publish-detail-status.component";
import { getBadgePlatformsForFormat, getClipperFormatDef } from "../shared/formats.util";
import { isFolderOnlyFormat } from "../shared/clipper-map-publish.util";

interface ClipperPublishDetailPanelProps {
  item: ClipperExportMapItem | null;
  result: ClipperFormatResult | null;
  mediaLoading: boolean;
  onMetadataSaved: (exportId: string, fields: ExportSocialFields) => void;
  onDeleted: () => void;
  onBack: () => void;
  connectedSplit?: boolean;
}

export function ClipperPublishDetailPanel({
  item,
  result,
  mediaLoading,
  onMetadataSaved,
  onDeleted,
  onBack,
  connectedSplit = false,
}: ClipperPublishDetailPanelProps) {
  const { theme } = useClipperUi();

  const handleMetadataSaved = useCallback(
    (exportId: string, fields: ExportSocialFields) => {
      onMetadataSaved(exportId, fields);
    },
    [onMetadataSaved],
  );

  const handleSlideDelete = useCallback(async () => {
    if (!item) return;

    try {
      await removeClipperExport({
        projectId: item.projectId,
        exportId: item.id,
      });

      appToast.success("Export removed", "The export was removed from the publish map.");
      onDeleted();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove export.";
      appToast.error("Delete failed", message);
      throw error;
    }
  }, [item, onDeleted]);

  if (!item || !result) {
    return (
      <Box
        h="full"
        borderRadius={connectedSplit ? 0 : "2xl"}
        border={connectedSplit ? "none" : "1px dashed"}
        borderColor={theme.dashboard.border}
        bg={connectedSplit ? "transparent" : theme.background.card}
        p={8}
        display="flex"
        alignItems="center"
        justifyContent="center"
        overflow="auto"
      >
        <Text color={theme.text.muted} textAlign="center">
          Select an export node on the map to preview and edit metadata.
        </Text>
      </Box>
    );
  }

  const formatDef = getClipperFormatDef(item.formatId);
  const badgePlatforms = getBadgePlatformsForFormat(item.formatId);
  const metadataReadOnly = isFolderOnlyFormat(item.formatId);

  return (
    <VStack
      align="stretch"
      h="full"
      minH={0}
      gap={4}
      p={4}
      borderRadius={connectedSplit ? 0 : "2xl"}
      border={connectedSplit ? "none" : "1px solid"}
      borderColor={theme.border.primary}
      bg={connectedSplit ? "transparent" : theme.background.card}
      overflow="auto"
    >
      <HStack justify="space-between" align="start" gap={3}>
        <HStack align="start" gap={2.5} flex={1} minW={0}>
          {formatDef ? (
            <HStack gap={1} flexShrink={0} pt={0.5}>
              {(badgePlatforms.length > 0 ? badgePlatforms : [formatDef.platform]).map((platform) => (
                <ClipperPlatformIcon key={platform} platform={platform} size={28} />
              ))}
            </HStack>
          ) : null}
          <VStack align="start" gap={1} flex={1} minW={0}>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} lineClamp={2}>
              {item.projectName}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              Clip {item.clipIndex + 1}
              {!formatDef ? ` · ${item.formatLabel}` : null}
            </Text>
          </VStack>
        </HStack>
        <OutlinedActionButton
          flexShrink={0}
          aria-label="Back to project"
          startIcon={<ArrowLeft size={16} />}
          onClick={onBack}
          px={2.5}
        >
          Back
        </OutlinedActionButton>
      </HStack>

      <ClipperExportRevealButton
        projectId={item.projectId}
        fileName={item.fileName}
        disabled={!mediaLoading && result.isMissing}
      />

      <ClipperPublishDetailStatus item={item} />

      {mediaLoading ? (
        <Center
          flexShrink={0}
          minH="180px"
          w="100%"
          borderRadius="xl"
          border="1px solid"
          borderColor={theme.surface.hover}
          bg="#000"
        >
          <AppLoader />
        </Center>
      ) : result.isMissing ? (
        <Center
          flexShrink={0}
          minH="180px"
          w="100%"
          px={4}
          borderRadius="xl"
          border="1px solid"
          borderColor={theme.surface.hover}
          bg="#000"
        >
          <Text fontSize="sm" color={theme.text.muted} textAlign="center">
            Export file not found on disk.
          </Text>
        </Center>
      ) : (
        <Box
          asChild
          flexShrink={0}
          alignSelf="center"
          maxH="50%"
          maxW="100%"
          w="auto"
          h="auto"
          display="block"
          bg="#000"
          borderRadius="xl"
          border="1px solid"
          borderColor={theme.surface.hover}
          objectFit="contain"
        >
          <video src={result.previewUrl} controls playsInline preload="metadata" />
        </Box>
      )}

      <ClipperExportMetadataPanel
        result={result}
        onMetadataSaved={handleMetadataSaved}
        readOnly={metadataReadOnly}
      />

      <VStack
        align="stretch"
        gap={3}
        pt={2}
        borderTop="1px solid"
        borderColor={theme.surface.hover}
      >
        <SlideToDeleteControl
          label="Slide to delete"
          onComplete={handleSlideDelete}
          disabled={mediaLoading || result.isMissing}
        />
      </VStack>
    </VStack>
  );
}
