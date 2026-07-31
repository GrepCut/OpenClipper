import React, { useEffect, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { ThemedInput, ThemedTextarea } from "../../../shared/components/ui/themed-input.component";
import type { Project } from "../../../services/projects.service";
import type {
  ClipperOwnerChannelRecord,
  ClipperOwnerRecord,
  ClipperProjectSummary,
} from "../persistence/clipper-owner-db-api.util";
import type { AvailableOwnerChannel } from "../shared/clipper-owner-channels.util";
import type { ClipperPlatform } from "../shared/formats.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

function platformLabel(platform: string): string {
  if (platform === "x") return "X";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

interface ClipperOwnerDetailPanelProps {
  owner: ClipperOwnerRecord;
  channels: ClipperOwnerChannelRecord[];
  projects: ClipperProjectSummary[];
  availableChannels: AvailableOwnerChannel[];
  allProjects: Project[];
  onSave: (name: string, notes: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddChannel: (channel: AvailableOwnerChannel) => Promise<void>;
  onRemoveChannel: (channelId: string) => Promise<void>;
  onAssignProject: (projectId: string) => Promise<void>;
  onUnassignProject: (projectId: string) => Promise<void>;
}

export function ClipperOwnerDetailPanel({
  owner,
  channels,
  projects,
  availableChannels,
  allProjects,
  onSave,
  onDelete,
  onAddChannel,
  onRemoveChannel,
  onAssignProject,
  onUnassignProject,
}: ClipperOwnerDetailPanelProps) {
  const { theme } = useClipperUi();
  const [name, setName] = useState(owner.name);
  const [notes, setNotes] = useState(owner.notes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(owner.name);
    setNotes(owner.notes);
  }, [owner.id, owner.name, owner.notes]);

  const unassignedProjects = useMemo(
    () => allProjects.filter((project) => !projects.some((row) => row.id === project.id)),
    [allProjects, projects],
  );

  const linkableChannels = useMemo(
    () => availableChannels.filter(
      (channel) => !channels.some(
        (row) =>
          row.platform === channel.platform &&
          row.externalId === channel.externalId,
      ),
    ),
    [availableChannels, channels],
  );

  return (
    <Box
      borderRadius="2xl"
      border="1px solid"
      borderColor={theme.border.primary}
      bg={theme.background.card}
      p={5}
    >
      <VStack align="stretch" gap={4}>
        <VStack align="stretch" gap={2}>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            Owner details
          </Text>
          <ThemedInput
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <ThemedTextarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Notes"
            resize="vertical"
          />
          <HStack gap={2}>
            <OutlinedActionButton
              loading={saving}
              onClick={() => {
                setSaving(true);
                void onSave(name.trim(), notes.trim()).finally(() => setSaving(false));
              }}
            >
              Save
            </OutlinedActionButton>
            <OutlinedActionButton
              tone="danger"
              startIcon={<Trash2 size={16} />}
              onClick={() => void onDelete()}
            >
              Delete
            </OutlinedActionButton>
          </HStack>
        </VStack>

        <VStack align="stretch" gap={2}>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            Channels
          </Text>
          {channels.length === 0 ? (
            <Text fontSize="sm" color={theme.text.muted}>
              No channels linked yet.
            </Text>
          ) : (
            channels.map((channel) => (
              <HStack
                key={channel.id}
                justify="space-between"
                borderRadius="xl"
                border="1px solid"
                borderColor={theme.surface.hover}
                bg={theme.surface.faint}
                px={3}
                py={2}
              >
                <HStack gap={2}>
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
                <OutlinedActionButton
                  tone="danger"
                  onClick={() => void onRemoveChannel(channel.id)}
                >
                  Remove
                </OutlinedActionButton>
              </HStack>
            ))
          )}
          {linkableChannels.map((channel) => (
            <OutlinedActionButton
              key={channel.platform}
              startIcon={<Plus size={16} />}
              onClick={() => void onAddChannel(channel)}
            >
              Link {platformLabel(channel.platform)}
            </OutlinedActionButton>
          ))}
        </VStack>

        <VStack align="stretch" gap={2}>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            Projects
          </Text>
          {projects.map((project) => (
            <HStack
              key={project.id}
              justify="space-between"
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
              px={3}
              py={2}
            >
              <Text fontSize="sm" color={theme.text.primary}>{project.name}</Text>
              <OutlinedActionButton onClick={() => void onUnassignProject(project.id)}>
                Unassign
              </OutlinedActionButton>
            </HStack>
          ))}
          {unassignedProjects.map((project) => (
            <OutlinedActionButton
              key={project.id}
              startIcon={<Plus size={16} />}
              onClick={() => void onAssignProject(project.id)}
            >
              Assign {project.name}
            </OutlinedActionButton>
          ))}
        </VStack>
      </VStack>
    </Box>
  );
}
