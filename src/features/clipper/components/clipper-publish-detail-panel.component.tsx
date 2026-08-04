import React, { useCallback } from "react";
import { Box, Center, HStack, Text, VStack } from "@chakra-ui/react";
import { CheckCircle2, ExternalLink } from "lucide-react";
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
import { getBadgePlatformsForFormat, getClipperFormatDef } from "../shared/formats.util";

interface ClipperPublishDetailPanelProps {
  item: ClipperExportMapItem | null;
  result: ClipperFormatResult | null;
  mediaLoading: boolean;
  onMetadataSaved: (exportId: string, fields: ExportSocialFields) => void;
  onDeleted: () => void;
  connectedSplit?: boolean;
}

export function ClipperPublishDetailPanel({
  item,
  result,
  mediaLoading,
  onMetadataSaved,
  onDeleted,
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
  const watchUrl = item.publishStatus?.watchUrl;

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
        <VStack align="start" gap={1} flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            {item.projectName}
          </Text>
          <Text fontSize="xs" color={theme.text.muted}>
            Clip {item.clipIndex + 1} · {item.formatLabel}
          </Text>
        </VStack>
        {formatDef ? (
          <HStack gap={1} flexShrink={0}>
            {(badgePlatforms.length > 0 ? badgePlatforms : [formatDef.platform]).map((platform) => (
              <ClipperPlatformIcon key={platform} platform={platform} size={28} />
            ))}
          </HStack>
        ) : null}
      </HStack>

      {item.isPublished ? (
        <HStack
          gap={2}
          p={3}
          borderRadius="xl"
          bg="rgba(34, 197, 94, 0.12)"
          border="1px solid"
          borderColor="rgba(34, 197, 94, 0.35)"
        >
          <CheckCircle2 size={18} color="#22c55e" />
          <Text fontSize="sm" color={theme.text.primary} flex={1}>
            Published to {item.formatLabel}
          </Text>
          {watchUrl ? (
            <Box asChild>
              <a href={watchUrl} target="_blank" rel="noopener noreferrer">
                <OutlinedActionButton
                  size="sm"
                  startIcon={<ExternalLink size={14} />}
                >
                  Open
                </OutlinedActionButton>
              </a>
            </Box>
          ) : null}
        </HStack>
      ) : null}

      <Box
        borderRadius="xl"
        overflow="hidden"
        bg={theme.background.surface}
        border="1px solid"
        borderColor={theme.surface.hover}
        minH="180px"
      >
        {mediaLoading ? (
          <Center minH="180px">
            <AppLoader />
          </Center>
        ) : result.isMissing ? (
          <Center minH="180px" px={4}>
            <Text fontSize="sm" color={theme.text.muted} textAlign="center">
              Export file not found on disk.
            </Text>
          </Center>
        ) : (
          <video
            src={result.previewUrl}
            controls
            style={{ width: "100%", display: "block", maxHeight: "280px" }}
          />
        )}
      </Box>

      <ClipperExportMetadataPanel
        result={result}
        onMetadataSaved={handleMetadataSaved}
        variant="inline"
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
