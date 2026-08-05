import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { StyledModal } from "../../../shared/components/styled-modal.component";
import { ThemedInput } from "../../../shared/components/ui/themed-input.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { useTheme } from "../../../theme";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import type { ClipperOwnerChannelRecord } from "../persistence/clipper-owner-db-api.util";
import {
  buildAvailableOwnerChannels,
  diffOwnerChannelSelection,
  ownerChannelsNeedingDisplayNameSync,
  resolveOwnerChannels,
  type AvailableOwnerChannel,
} from "../shared/clipper-owner-channels.util";
import { appToast } from "../../../shared/utils/toast.service";
import type { ClipperLayoutBackLink } from "../components/clipper-layout.component";
import { ClipperOwnerDetailPanel } from "./clipper-owner-detail-panel.component";
import { ClipperOwnerListRow } from "./clipper-owner-list-row.component";
import { ClipperOwnerChannelPicker } from "./clipper-owner-channel-picker.component";

type OwnersScreen = "list" | "detail" | "channels";

interface ClipperOwnersViewProps {
  onOpenIntegrations?: () => void;
  onHeaderBackChange?: (back: ClipperLayoutBackLink | null) => void;
}

export function ClipperOwnersView({ onOpenIntegrations, onHeaderBackChange }: ClipperOwnersViewProps) {
  const { theme } = useTheme();
  const { user, token, isAuthenticated, sessionMode } = useAuth();
  const canUseAccountFeatures = Boolean(
    user && token && isAuthenticated && sessionMode === "online",
  );
  const {
    owners,
    loading,
    saveOwner,
    removeOwner,
    saveOwnerChannel,
    removeOwnerChannel,
    loadOwnerChannels,
  } = useClipperOwners();
  const {
    connections: youtubeConnections,
    refreshStatus: refreshYoutubeStatus,
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((state) => state.platforms);
  const refreshSocial = useSocialStore((state) => state.refreshAll);
  const [screen, setScreen] = useState<OwnersScreen>("list");
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ClipperOwnerChannelRecord[]>([]);
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

  const resolvedChannels = useMemo(
    () => resolveOwnerChannels(channels, availableChannels),
    [channels, availableChannels],
  );

  const refreshOwnerData = useCallback(async (ownerId: string) => {
    const linked = await loadOwnerChannels(ownerId);
    setChannels(linked);

    if (!canUseAccountFeatures) return;

    const available = buildAvailableOwnerChannels({
      youtubeConnections,
      socialPlatforms,
    });
    const resolved = resolveOwnerChannels(linked, available);
    const stale = ownerChannelsNeedingDisplayNameSync(resolved);
    if (stale.length === 0) return;

    await Promise.all(
      stale.map((item) =>
        saveOwnerChannel({
          id: item.linked.id,
          ownerId: item.linked.ownerId,
          platform: item.linked.platform,
          externalId: item.linked.externalId,
          displayName: item.displayName,
        }),
      ),
    );
    setChannels(await loadOwnerChannels(ownerId));
  }, [
    canUseAccountFeatures,
    loadOwnerChannels,
    saveOwnerChannel,
    socialPlatforms,
    youtubeConnections,
  ]);

  useEffect(() => {
    if (!canUseAccountFeatures) return;
    void refreshYoutubeStatus();
    void refreshSocial();
  }, [canUseAccountFeatures, refreshSocial, refreshYoutubeStatus]);

  useEffect(() => {
    if (!selectedOwnerId || screen === "list") {
      setChannels([]);
      return;
    }
    void refreshOwnerData(selectedOwnerId);
  }, [selectedOwnerId, screen, refreshOwnerData, owners]);

  const handleCreateOwner = useCallback(async () => {
    const name = newOwnerName.trim();
    if (!name) return;
    const saved = await saveOwner({ name });
    setNewOwnerName("");
    setCreateOpen(false);
    setSelectedOwnerId(saved.id);
    setScreen("detail");
    appToast.success("Owner created", `${saved.name} is ready.`);
  }, [newOwnerName, saveOwner]);

  const handleOpenOwner = useCallback((ownerId: string) => {
    setSelectedOwnerId(ownerId);
    setScreen("detail");
  }, []);

  const handleBackToList = useCallback(() => {
    setScreen("list");
    setSelectedOwnerId(null);
  }, []);

  const handleBackToDetail = useCallback(() => {
    setScreen("detail");
  }, []);

  useEffect(() => {
    if (!onHeaderBackChange) return;

    if (screen === "list") {
      onHeaderBackChange(null);
      return;
    }
    if (screen === "detail") {
      onHeaderBackChange({
        label: "Back to owners",
        onClick: handleBackToList,
      });
      return;
    }
    if (screen === "channels" && selectedOwner) {
      onHeaderBackChange({
        label: `Back to ${selectedOwner.name}`,
        onClick: handleBackToDetail,
      });
    }
  }, [screen, selectedOwner, handleBackToList, handleBackToDetail, onHeaderBackChange]);

  useEffect(() => {
    return () => onHeaderBackChange?.(null);
  }, [onHeaderBackChange]);

  const handleDeleteOwner = useCallback(async () => {
    if (!selectedOwner) return;
    await removeOwner(selectedOwner.id);
    setSelectedOwnerId(null);
    setScreen("list");
    appToast.success("Owner deleted");
  }, [removeOwner, selectedOwner]);

  const handleChannelsChange = useCallback(async (selected: AvailableOwnerChannel[]) => {
    if (!selectedOwner) return;
    const { toAdd, toRemove } = diffOwnerChannelSelection(channels, selected);
    try {
      for (const channel of toRemove) {
        await removeOwnerChannel(channel.id);
      }
      for (const channel of toAdd) {
        await saveOwnerChannel({
          ownerId: selectedOwner.id,
          platform: channel.platform,
          externalId: channel.externalId,
          displayName: channel.displayName,
        });
      }
      await refreshOwnerData(selectedOwner.id);
    } catch (error) {
      await refreshOwnerData(selectedOwner.id);
      throw error;
    }
  }, [channels, refreshOwnerData, removeOwnerChannel, saveOwnerChannel, selectedOwner]);

  if (screen === "channels" && selectedOwner) {
    return (
      <ClipperOwnerChannelPicker
        availableChannels={availableChannels}
        linkedChannels={channels}
        onSelectionChange={handleChannelsChange}
        onOpenIntegrations={() => onOpenIntegrations?.()}
      />
    );
  }

  if (screen === "detail" && selectedOwner) {
    return (
      <ClipperOwnerDetailPanel
        owner={selectedOwner}
        channels={resolvedChannels}
        onManageChannels={() => setScreen("channels")}
        onSave={async (name, notes) => {
          await saveOwner({ id: selectedOwner.id, name, notes });
          appToast.success("Owner saved");
        }}
        onDelete={handleDeleteOwner}
      />
    );
  }

  return (
    <VStack align="stretch" gap={8} flex="1" minH={0}>
      <HStack justify="space-between" align="start" flexWrap="wrap" gap={4} flexShrink={0}>
        <VStack align="start" gap={2} maxW="640px">
          <SecondaryMainTitle
            fontSize={{ base: "2xl", md: "3xl" }}
            fontWeight="bold"
            color={theme.text.primary}
          >
            Owners
          </SecondaryMainTitle>
          <Text color={theme.text.muted}>
            Group projects under content owners and link integrated channels for publishing.
          </Text>
        </VStack>
        <VStack align="stretch" gap={2} minW={{ base: "full", sm: "240px" }}>
          <OutlinedActionButton
            width="100%"
            justifyContent="flex-start"
            startIcon={<Plus size={16} />}
            onClick={() => setCreateOpen(true)}
          >
            Add owner
          </OutlinedActionButton>
        </VStack>
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
          flex="1"
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          <Text color={theme.text.primary} fontWeight="semibold" mb={2}>
            No owners yet
          </Text>
          <Text color={theme.text.muted} mb={5}>
            Create an owner to assign projects and connect integrated channels.
          </Text>
          <OutlinedActionButton
            width="100%"
            maxW="320px"
            justifyContent="center"
            startIcon={<Plus size={16} />}
            onClick={() => setCreateOpen(true)}
          >
            Add owner
          </OutlinedActionButton>
        </Box>
      ) : (
        <VStack align="stretch" gap={3}>
          {owners.map((owner) => (
            <ClipperOwnerListRow
              key={owner.id}
              owner={owner}
              onOpen={() => handleOpenOwner(owner.id)}
            />
          ))}
        </VStack>
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
