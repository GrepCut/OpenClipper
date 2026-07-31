import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Plus, UserRound } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { StyledModal } from "../../../shared/components/styled-modal.component";
import { ThemedInput } from "../../../shared/components/ui/themed-input.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { useTheme } from "../../../theme";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import type {
  ClipperOwnerChannelRecord,
  ClipperProjectSummary,
} from "../persistence/clipper-owner-db-api.util";
import { buildAvailableOwnerChannels } from "../shared/clipper-owner-channels.util";
import { appToast } from "../../../shared/utils/toast.service";
import { projectsService, type Project } from "../../../services/projects.service";
import { ClipperOwnerDetailPanel } from "./clipper-owner-detail-panel.component";

export function ClipperOwnersView() {
  const { theme } = useTheme();
  const {
    owners,
    loading,
    saveOwner,
    removeOwner,
    saveOwnerChannel,
    removeOwnerChannel,
    loadOwnerChannels,
    loadOwnerProjects,
    assignProjectOwner,
  } = useClipperOwners();
  const {
    connections: youtubeConnections,
    refreshStatus: refreshYoutubeStatus,
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((state) => state.platforms);
  const refreshSocial = useSocialStore((state) => state.refreshAll);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ClipperOwnerChannelRecord[]>([]);
  const [ownerProjects, setOwnerProjects] = useState<ClipperProjectSummary[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState("");

  const selectedOwner = owners.find((owner) => owner.id === selectedOwnerId) ?? null;

  const availableChannels = useMemo(
    () => buildAvailableOwnerChannels({
      youtubeConnections,
      socialPlatforms,
    }),
    [youtubeConnections, socialPlatforms],
  );

  useEffect(() => {
    void refreshYoutubeStatus();
    void refreshSocial();
  }, [refreshSocial, refreshYoutubeStatus]);

  useEffect(() => {
    void projectsService.getAll(1, 100, "", "clipper", "updatedAt").then((response) => {
      setAllProjects(response.data);
    });
  }, []);

  useEffect(() => {
    if (!selectedOwnerId) {
      setChannels([]);
      setOwnerProjects([]);
      return;
    }
    void loadOwnerChannels(selectedOwnerId).then(setChannels);
    void loadOwnerProjects(selectedOwnerId).then(setOwnerProjects);
  }, [selectedOwnerId, loadOwnerChannels, loadOwnerProjects, owners]);

  const handleCreateOwner = useCallback(async () => {
    const name = newOwnerName.trim();
    if (!name) return;
    const saved = await saveOwner({ name });
    setNewOwnerName("");
    setCreateOpen(false);
    setSelectedOwnerId(saved.id);
    appToast.success("Owner created", `${saved.name} is ready.`);
  }, [newOwnerName, saveOwner]);

  return (
    <VStack align="stretch" gap={6} flex="1" minH={0}>
      <HStack justify="space-between" align="start" flexWrap="wrap" gap={4}>
        <VStack align="start" gap={2} maxW="640px">
          <SecondaryMainTitle fontSize={{ base: "2xl", md: "3xl" }} fontWeight="bold" color={theme.text.primary}>
            Owners
          </SecondaryMainTitle>
          <Text color={theme.text.muted}>
            Group projects under content owners and link integrated channels for publishing.
          </Text>
        </VStack>
        <OutlinedActionButton startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
          Add owner
        </OutlinedActionButton>
      </HStack>

      {loading ? (
        <Text color={theme.text.muted}>Loading owners…</Text>
      ) : owners.length === 0 ? (
        <Box
          p={10}
          borderRadius="2xl"
          border="1px dashed"
          borderColor={theme.dashboard.border}
          textAlign="center"
          bg={theme.background.card}
        >
          <Text color={theme.text.primary} fontWeight="semibold" mb={2}>
            No owners yet
          </Text>
          <Text color={theme.text.muted}>
            Create an owner to assign projects and connect integrated channels.
          </Text>
        </Box>
      ) : (
        <HStack align="start" gap={4} flexWrap={{ base: "wrap", lg: "nowrap" }}>
          <VStack align="stretch" gap={2} flex="1" minW="280px">
            {owners.map((owner) => (
              <Box
                key={owner.id}
                as="button"
                onClick={() => setSelectedOwnerId(owner.id)}
                borderRadius="2xl"
                border="1px solid"
                borderColor={selectedOwnerId === owner.id ? theme.brand.purpleSoftAlpha12 : theme.surface.hover}
                bg={selectedOwnerId === owner.id ? theme.surface.faint : theme.background.card}
                p={4}
                textAlign="left"
              >
                <HStack gap={3}>
                  <Box color={theme.text.muted}>
                    <UserRound size={20} />
                  </Box>
                  <VStack align="start" gap={0.5} flex={1}>
                    <Text fontWeight="semibold" color={theme.text.primary}>{owner.name}</Text>
                    <Text fontSize="xs" color={theme.text.muted}>
                      {owner.projectCount} projects · {owner.channelCount} channels
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            ))}
          </VStack>

          {selectedOwner ? (
            <Box flex="1.4" minW="320px">
              <ClipperOwnerDetailPanel
                owner={selectedOwner}
                channels={channels}
                projects={ownerProjects}
                availableChannels={availableChannels}
                allProjects={allProjects}
                onSave={async (name, notes) => {
                  await saveOwner({ id: selectedOwner.id, name, notes });
                  appToast.success("Owner saved");
                }}
                onDelete={async () => {
                  await removeOwner(selectedOwner.id);
                  setSelectedOwnerId(null);
                  appToast.success("Owner deleted");
                }}
                onAddChannel={async (channel) => {
                  await saveOwnerChannel({
                    ownerId: selectedOwner.id,
                    platform: channel.platform,
                    externalId: channel.externalId,
                    displayName: channel.displayName,
                  });
                  setChannels(await loadOwnerChannels(selectedOwner.id));
                }}
                onRemoveChannel={async (channelId) => {
                  await removeOwnerChannel(channelId);
                  setChannels(await loadOwnerChannels(selectedOwner.id));
                }}
                onAssignProject={async (projectId) => {
                  await assignProjectOwner(projectId, selectedOwner.id);
                  setOwnerProjects(await loadOwnerProjects(selectedOwner.id));
                }}
                onUnassignProject={async (projectId) => {
                  await assignProjectOwner(projectId, null);
                  setOwnerProjects(await loadOwnerProjects(selectedOwner.id));
                }}
              />
            </Box>
          ) : null}
        </HStack>
      )}

      <StyledModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add owner"
        footer={
          <OutlinedActionButton onClick={() => void handleCreateOwner()}>
            Create
          </OutlinedActionButton>
        }
      >
        <ThemedInput
          value={newOwnerName}
          onChange={(event) => setNewOwnerName(event.target.value)}
          placeholder="Owner name"
        />
      </StyledModal>
    </VStack>
  );
}
