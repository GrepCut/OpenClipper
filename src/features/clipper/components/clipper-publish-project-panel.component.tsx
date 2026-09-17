import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";
import { ThemedSelect } from "../../../shared/components/ui/themed-select.component";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import {
  buildAvailableOwnerChannels,
  resolvePublishConnectionsForOwner,
  type OwnerPublishConnectionResult,
} from "../shared/clipper-owner-channels.util";
import { useClipperPublishExportThumbnails } from "../hooks/use-clipper-publish-export-thumbnails.hook";
import { compareMapPublishExports, getMapPublishTargets } from "../shared/clipper-map-publish.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPublishProjectExportRow } from "./clipper-publish-project-export-row.component";

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
  onPublishExport: (item: ClipperExportMapItem, platform: SocialPublishablePlatform) => void;
  onSelectExport: (exportId: string) => void;
  connectedSplit?: boolean;
}

export function ClipperPublishProjectPanel({
  project,
  canPublish,
  publishLoadingExportId,
  onPublishExport,
  onSelectExport,
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
    return [...project.exports].sort(compareMapPublishExports);
  }, [project]);

  const { thumbnails } = useClipperPublishExportThumbnails(sortedExports);

  const exportConnections = useMemo(() => {
    const map = new Map<string, OwnerPublishConnectionResult>();
    if (!project?.clipperOwnerId) return map;

    for (const item of project.exports) {
      for (const platform of getMapPublishTargets(item.formatId)) {
        map.set(
          `${item.id}:${platform}`,
          resolvePublishConnectionsForOwner({
            platform,
            ownerChannels: linkedChannels,
            availableChannels,
            youtubeConnections,
            socialPlatforms,
          }),
        );
      }
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
        {sortedExports.length === 0 ? (
          <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5">
            No exports for this project yet.
          </Text>
        ) : (
          sortedExports.map((item) => (
            <ClipperPublishProjectExportRow
              key={item.id}
              item={item}
              hasOwner={hasOwner}
              canPublish={canPublish}
              publishLoadingExportId={publishLoadingExportId}
              connections={exportConnections}
              thumbnail={thumbnails[item.id]}
              onPublishExport={onPublishExport}
              onSelectExport={onSelectExport}
            />
          ))
        )}
      </VStack>
    </VStack>
  );
}
