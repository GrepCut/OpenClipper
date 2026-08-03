import React, { useEffect, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import {
  buildAvailableOwnerChannels,
  platformLabel,
  resolveOwnerChannels,
} from "../shared/clipper-owner-channels.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperOwnerChannelPlatformIcon } from "./clipper-owner-channel-platform-icon.component";
import { ClipperOwnerChannelStatusBadge } from "./clipper-owner-channel-status-badge.component";

interface ClipperPublishOwnerPanelProps {
  ownerId: string | null;
  connectedSplit?: boolean;
}

export function ClipperPublishOwnerPanel({
  ownerId,
  connectedSplit = false,
}: ClipperPublishOwnerPanelProps) {
  const { theme } = useClipperUi();
  const { owners, loadOwnerChannels } = useClipperOwners();
  const youtubeConnections = useYoutubeStore((state) => state.connections);
  const socialPlatforms = useSocialStore((state) => state.platforms);
  const [linkedChannels, setLinkedChannels] = useState<Awaited<ReturnType<typeof loadOwnerChannels>>>([]);

  const owner = owners.find((row) => row.id === ownerId) ?? null;

  const availableChannels = useMemo(
    () => buildAvailableOwnerChannels({ youtubeConnections, socialPlatforms }),
    [youtubeConnections, socialPlatforms],
  );

  const channels = useMemo(
    () => resolveOwnerChannels(linkedChannels, availableChannels),
    [linkedChannels, availableChannels],
  );

  useEffect(() => {
    if (!ownerId) {
      setLinkedChannels([]);
      return;
    }
    void loadOwnerChannels(ownerId).then(setLinkedChannels);
  }, [ownerId, loadOwnerChannels, owners]);

  if (!ownerId) {
    return null;
  }

  if (!owner) {
    return (
      <Box p={8}>
        <Text color={theme.text.muted}>Loading owner…</Text>
      </Box>
    );
  }

  return (
    <VStack
      align="stretch"
      h="full"
      gap={4}
      borderRadius={connectedSplit ? 0 : "2xl"}
      border={connectedSplit ? "none" : "1px solid"}
      borderColor={theme.border.primary}
      bg={connectedSplit ? "transparent" : theme.background.card}
      p={4}
      overflow="auto"
    >
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          {owner.name}
        </Text>
        <Text fontSize="xs" color={theme.text.muted}>
          {owner.projectCount} projects · {channels.length} channels
        </Text>
      </VStack>

      {owner.notes ? (
        <Text fontSize="sm" color={theme.text.muted}>
          {owner.notes}
        </Text>
      ) : null}

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Channels
        </Text>
        {channels.length === 0 ? (
          <Text fontSize="sm" color={theme.text.muted}>
            No channels linked. Add them in the Owners tab.
          </Text>
        ) : (
          channels.map((channel) => (
            <HStack
              key={channel.linked.id}
              gap={2}
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
              px={3}
              py={2}
            >
              <ClipperOwnerChannelPlatformIcon platform={channel.linked.platform} size={20} />
              <VStack align="start" gap={0} flex={1} minW={0}>
                <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                  {platformLabel(channel.linked.platform)}
                </Text>
                <Text fontSize="xs" color={theme.text.muted} lineClamp={1}>
                  {channel.displayName}
                </Text>
              </VStack>
              <ClipperOwnerChannelStatusBadge status={channel.status} />
            </HStack>
          ))
        )}
      </VStack>
    </VStack>
  );
}
