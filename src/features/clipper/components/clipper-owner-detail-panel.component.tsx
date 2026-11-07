import React, { useEffect, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Link2, Trash2 } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { StyledModal, StyledModalFooter } from "../../../shared/components/styled-modal.component";
import { ThemedInput, ThemedTextarea } from "../../../shared/components/ui/themed-input.component";
import type {
  ClipperOwnerChannelRecord,
  ClipperOwnerRecord,
  ClipperProjectSummary,
} from "../persistence/clipper-owner-db-api.util";
import { appToast } from "../../../shared/utils/toast.service";
import { extractApiErrorMessage } from "../../../shared/utils/api-client.util";
import { platformLabel, type ResolvedOwnerChannel } from "../shared/clipper-owner-channels.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperOwnerChannelPlatformIcon } from "./clipper-owner-channel-platform-icon.component";
import { ClipperOwnerChannelStatusBadge } from "./clipper-owner-channel-status-badge.component";

interface ClipperOwnerDetailPanelProps {
  owner: ClipperOwnerRecord;
  channels: ResolvedOwnerChannel[];
  projects: ClipperProjectSummary[];
  projectsLoading: boolean;
  onManageChannels: () => void;
  onSave: (name: string, notes: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function ClipperOwnerDetailPanel({
  owner,
  channels,
  projects,
  projectsLoading,
  onManageChannels,
  onSave,
  onDelete,
}: ClipperOwnerDetailPanelProps) {
  const { theme, mode } = useClipperUi();
  const rowBg = mode === "dark" ? theme.background.card : "gray.50";
  const [name, setName] = useState(owner.name);
  const [notes, setNotes] = useState(owner.notes);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(owner.name);
    setNotes(owner.notes);
  }, [owner.id, owner.name, owner.notes]);

  return (
    <>
    <HStack align="start" gap={6} flex="1" minH={0} flexWrap={{ base: "wrap", lg: "nowrap" }}>
      <VStack align="stretch" gap={4} flex="1" minW={{ base: "full", lg: "0" }}>
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
        <HStack gap={2} justify="flex-end" flexWrap="wrap">
          <OutlinedActionButton
            tone="danger"
            startIcon={<Trash2 size={16} />}
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={projectsLoading || projects.length > 0}
          >
            Delete
          </OutlinedActionButton>
          <OutlinedActionButton
            loading={saving}
            onClick={() => {
              setSaving(true);
              void onSave(name.trim(), notes.trim())
                .catch((error) => appToast.error("Could not save owner", extractApiErrorMessage(error)))
                .finally(() => setSaving(false));
            }}
          >
            Save
          </OutlinedActionButton>
        </HStack>
        {projectsLoading ? <Text fontSize="sm">Loading assigned projects…</Text> : projects.length > 0 ? (
          <VStack align="start" gap={1}>
            <Text fontSize="sm" color={theme.text.muted}>Unassign these projects before deleting this owner:</Text>
            {projects.map((project) => <Text key={project.id} fontSize="sm">{project.name}</Text>)}
          </VStack>
        ) : null}
      </VStack>

      <VStack align="stretch" gap={3} flex="1" minW={{ base: "full", lg: "0" }}>
        <HStack justify="space-between" align="center" gap={3} flexWrap="wrap">
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            Channels
          </Text>
          <OutlinedActionButton
            alignSelf="flex-start"
            flexShrink={0}
            startIcon={<Link2 size={16} />}
            onClick={onManageChannels}
          >
            Manage channels
          </OutlinedActionButton>
        </HStack>

        {channels.length === 0 ? (
          <Box bg={rowBg} borderRadius="2xl" p={4}>
            <Text fontSize="sm" color={theme.text.muted}>
              No channels linked yet. Manage channels to connect integrated accounts.
            </Text>
          </Box>
        ) : (
          <VStack align="stretch" gap={2}>
            {channels.map((channel) => (
              <Box key={channel.linked.id} bg={rowBg} borderRadius="2xl" px={4} py={3}>
                <HStack gap={3} minW={0} align="center">
                  <ClipperOwnerChannelPlatformIcon platform={channel.linked.platform} size={24} />
                  <VStack align="start" gap={0.5} minW={0} flex={1}>
                    <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                      {platformLabel(channel.linked.platform)}
                    </Text>
                    <Text fontSize="xs" color={theme.text.muted} lineClamp={1}>
                      {channel.displayName}
                    </Text>
                  </VStack>
                  <ClipperOwnerChannelStatusBadge status={channel.status} />
                </HStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>
    </HStack>

      <StyledModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteConfirmOpen(false);
          }
        }}
        title="Delete owner"
        closeOnOverlayClick={!deleting}
        isLoading={deleting}
        footer={
          <StyledModalFooter
            cancelText="Cancel"
            submitText="Delete"
            submitColorScheme="red"
            isLoading={deleting}
            onCancel={() => setDeleteConfirmOpen(false)}
            onSubmit={() => {
              setDeleting(true);
              void onDelete()
                .then(() => setDeleteConfirmOpen(false))
                .catch((error) => appToast.error("Could not delete owner",
                  /Cannot delete owner while projects are still assigned/i.test(String(error))
                    ? "Projects are still assigned to this owner. Unassign them and retry."
                    : extractApiErrorMessage(error)))
                .finally(() => setDeleting(false));
            }}
          />
        }
      >
        <Text fontSize="sm" color={theme.text.muted}>
          Are you sure you want to delete &ldquo;{owner.name}&rdquo;? This action cannot be undone.
        </Text>
      </StyledModal>
    </>
  );
}
