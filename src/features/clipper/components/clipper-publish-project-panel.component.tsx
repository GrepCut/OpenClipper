import React, { useEffect, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { publishPlatformForFormat } from "../../../services/types/social-auth.types";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { ThemedSelect } from "../../../shared/components/ui/themed-select.component";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { missingMetadataFieldLabels } from "../persistence/clipper-export-social.util";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import {
  buildAvailableOwnerChannels,
  resolvePublishConnectionsForOwner,
  type OwnerPublishConnectionResult,
} from "../shared/clipper-owner-channels.util";
import { getOwnerPublishBlockedMessage } from "../shared/resolve-owner-publish-connection.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";
import { getClipperFormatDef } from "../shared/formats.util";

interface SelectedPublishProject {
  projectId: string;
  projectName: string;
  clipperOwnerId: string | null;
  clipperOwnerName: string | null;
  exports: ClipperExportMapItem[];
}

interface ClipperPublishProjectPanelProps {
  project: SelectedPublishProject | null;
  canPublish: boolean;
  publishLoadingExportId: string | null;
  onPublishExport: (item: ClipperExportMapItem) => void;
  connectedSplit?: boolean;
}

function exportPublishPlatform(item: ClipperExportMapItem) {
  const formatPlatform = item.platform === "twitter" ? "twitter" : item.platform;
  return publishPlatformForFormat(formatPlatform) ?? "youtube";
}

function MetadataIncompleteBanner({
  missingFields,
  warningColor,
}: {
  missingFields: string[];
  warningColor: string;
}) {
  const labels = missingMetadataFieldLabels(missingFields);
  if (labels.length === 0) return null;

  return (
    <HStack
      align="start"
      gap={2.5}
      px={3}
      py={2.5}
      borderRadius="lg"
      bg="rgba(255, 149, 0, 0.1)"
      border="1px solid"
      borderColor="rgba(255, 149, 0, 0.28)"
    >
      <Box flexShrink={0} mt="1px" color={warningColor}>
        <AlertTriangle size={14} />
      </Box>
      <VStack align="start" gap={1.5} flex={1} minW={0}>
        <Text fontSize="xs" fontWeight="semibold" color={warningColor} lineHeight="1.35">
          Metadata incomplete
        </Text>
        <HStack gap={1.5} flexWrap="wrap">
          {labels.map((label) => (
            <Box
              key={label}
              as="span"
              px={2}
              py={0.5}
              borderRadius="full"
              bg="rgba(255, 149, 0, 0.14)"
              border="1px solid"
              borderColor="rgba(255, 149, 0, 0.22)"
              fontSize="xs"
              fontWeight="medium"
              color={warningColor}
              lineHeight="1.2"
            >
              {label}
            </Box>
          ))}
        </HStack>
      </VStack>
    </HStack>
  );
}

export function ClipperPublishProjectPanel({
  project,
  canPublish,
  publishLoadingExportId,
  onPublishExport,
  connectedSplit = false,
}: ClipperPublishProjectPanelProps) {
  const { theme } = useClipperUi();
  const { owners, assignProjectOwner, loadOwnerChannels } = useClipperOwners();
  const youtubeConnections = useYoutubeStore((state) => state.connections);
  const socialPlatforms = useSocialStore((state) => state.platforms);
  const [linkedChannels, setLinkedChannels] = useState<
    Awaited<ReturnType<typeof loadOwnerChannels>>
  >([]);

  useEffect(() => {
    if (!project?.clipperOwnerId) {
      setLinkedChannels([]);
      return;
    }
    void loadOwnerChannels(project.clipperOwnerId).then(setLinkedChannels);
  }, [project?.clipperOwnerId, loadOwnerChannels, owners]);

  const availableChannels = useMemo(
    () => buildAvailableOwnerChannels({ youtubeConnections, socialPlatforms }),
    [youtubeConnections, socialPlatforms],
  );

  const ownerSelectOptions = useMemo(
    () => [
      { value: "", label: "Unassigned" },
      ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
    ],
    [owners],
  );

  const hasOwner = Boolean(project?.clipperOwnerId);
  const sortedExports = useMemo(() => {
    if (!project) return [];
    return [...project.exports].sort(
      (a, b) => a.clipIndex - b.clipIndex || a.formatLabel.localeCompare(b.formatLabel),
    );
  }, [project]);

  const exportConnections = useMemo(() => {
    const map = new Map<string, OwnerPublishConnectionResult>();
    if (!project?.clipperOwnerId) return map;

    for (const item of project.exports) {
      const platform = exportPublishPlatform(item);
      map.set(
        item.id,
        resolvePublishConnectionsForOwner({
          platform,
          ownerChannels: linkedChannels,
          availableChannels,
          youtubeConnections,
          socialPlatforms,
        }),
      );
    }

    return map;
  }, [
    project?.clipperOwnerId,
    project?.exports,
    linkedChannels,
    availableChannels,
    youtubeConnections,
    socialPlatforms,
  ]);

  if (!project) {
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
      >
        <Text color={theme.text.muted} textAlign="center">
          Select the project hub on the map to assign an owner and publish exports.
        </Text>
      </Box>
    );
  }

  return (
    <VStack
      align="stretch"
      h="full"
      gap={5}
      borderRadius={connectedSplit ? 0 : "2xl"}
      border={connectedSplit ? "none" : "1px solid"}
      borderColor={theme.border.primary}
      bg={connectedSplit ? "transparent" : theme.background.card}
      p={4}
      overflow="auto"
    >
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          {project.projectName}
        </Text>
        <Text fontSize="xs" color={theme.text.muted}>
          {project.exports.length} export{project.exports.length !== 1 ? "s" : ""}
        </Text>
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Owner
        </Text>
        <ThemedSelect
          value={project.clipperOwnerId ?? ""}
          onChange={(value) => void assignProjectOwner(project.projectId, value || null)}
          options={ownerSelectOptions}
        />
        {!hasOwner ? (
          <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5">
            Assign an owner before publishing. Owner channels are configured in the Owners tab.
          </Text>
        ) : null}
      </VStack>

      <VStack align="stretch" gap={2.5}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Publish
        </Text>
        {sortedExports.map((item) => {
          const formatDef = getClipperFormatDef(item.formatId);
          const watchUrl = item.publishStatus?.watchUrl;
          const platform = exportPublishPlatform(item);
          const connection = exportConnections.get(item.id);
          const channelConnected = connection?.connected ?? false;
          const blockedHint =
            hasOwner && connection
              ? getOwnerPublishBlockedMessage(platform, connection)
              : null;
          const showMetadataWarning = !item.isPublished && item.missingFields.length > 0;

          return (
            <VStack
              key={item.id}
              align="stretch"
              gap={2.5}
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
              px={3.5}
              py={3}
            >
              <HStack align="center" gap={3}>
                {formatDef ? (
                  <Box
                    flexShrink={0}
                    w="40px"
                    h="40px"
                    borderRadius="lg"
                    bg={theme.background.surface}
                    border="1px solid"
                    borderColor={theme.surface.hover}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <ClipperPlatformIcon platform={formatDef.platform} size={22} />
                  </Box>
                ) : null}
                <VStack align="start" gap={0.5} flex={1} minW={0}>
                  <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} lineClamp={1}>
                    {item.formatLabel}
                  </Text>
                  <Text fontSize="xs" color={theme.text.muted}>
                    Clip {item.clipIndex + 1}
                  </Text>
                </VStack>
                {item.isPublished ? (
                  <HStack gap={2} flexShrink={0}>
                    <CheckCircle2 size={16} color="#22c55e" />
                    {watchUrl ? (
                      <Box asChild>
                        <a href={watchUrl} target="_blank" rel="noopener noreferrer">
                          <OutlinedActionButton size="sm" startIcon={<ExternalLink size={14} />}>
                            Open
                          </OutlinedActionButton>
                        </a>
                      </Box>
                    ) : (
                      <Text fontSize="xs" color={theme.text.muted}>
                        Published
                      </Text>
                    )}
                  </HStack>
                ) : (
                  <OutlinedActionButton
                    flexShrink={0}
                    loading={publishLoadingExportId === item.id}
                    onClick={() => onPublishExport(item)}
                    disabled={!hasOwner || !canPublish || !channelConnected}
                  >
                    Publish
                  </OutlinedActionButton>
                )}
              </HStack>

              {showMetadataWarning ? (
                <MetadataIncompleteBanner
                  missingFields={item.missingFields}
                  warningColor={theme.status.warning}
                />
              ) : null}

              {!item.isPublished && blockedHint ? (
                <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5" px={0.5}>
                  {blockedHint}
                </Text>
              ) : null}
            </VStack>
          );
        })}
      </VStack>
    </VStack>
  );
}
