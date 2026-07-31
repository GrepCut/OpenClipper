import React, { useEffect, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import type { ClipperOwnerChannelRecord, ClipperProjectSummary } from "../persistence/clipper-owner-db-api.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";
import type { ClipperPlatform } from "../shared/formats.util";

interface ClipperPublishOwnerPanelProps {
  ownerId: string | null;
  connectedSplit?: boolean;
}

function platformLabel(platform: string): string {
  if (platform === "x") return "X";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function ClipperPublishOwnerPanel({
  ownerId,
  connectedSplit = false,
}: ClipperPublishOwnerPanelProps) {
  const { theme } = useClipperUi();
  const { owners, loadOwnerChannels, loadOwnerProjects } = useClipperOwners();
  const [channels, setChannels] = useState<ClipperOwnerChannelRecord[]>([]);
  const [projects, setProjects] = useState<ClipperProjectSummary[]>([]);

  const owner = owners.find((row) => row.id === ownerId) ?? null;

  useEffect(() => {
    if (!ownerId) {
      setChannels([]);
      setProjects([]);
      return;
    }
    void loadOwnerChannels(ownerId).then(setChannels);
    void loadOwnerProjects(ownerId).then(setProjects);
  }, [ownerId, loadOwnerChannels, loadOwnerProjects, owners]);

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
          {projects.length} projects · {channels.length} channels
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
              key={channel.id}
              gap={2}
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
              px={3}
              py={2}
            >
              <ClipperPlatformIcon platform={channel.platform as ClipperPlatform} size={20} />
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                  {platformLabel(channel.platform)}
                </Text>
                <Text fontSize="xs" color={theme.text.muted}>
                  {channel.displayName}
                </Text>
              </VStack>
            </HStack>
          ))
        )}
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Projects
        </Text>
        {projects.length === 0 ? (
          <Text fontSize="sm" color={theme.text.muted}>
            No projects assigned yet.
          </Text>
        ) : (
          projects.map((project) => (
            <Box
              key={project.id}
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
              px={3}
              py={2}
            >
              <Text fontSize="sm" color={theme.text.primary}>{project.name}</Text>
            </Box>
          ))
        )}
      </VStack>
    </VStack>
  );
}
