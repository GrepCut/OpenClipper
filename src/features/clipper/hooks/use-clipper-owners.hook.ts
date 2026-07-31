import { useCallback, useEffect, useState } from "react";
import {
  deleteClipperOwner,
  fetchClipperOwnerChannels,
  fetchClipperOwnerProjects,
  fetchClipperOwners,
  setClipperProjectOwner,
  upsertClipperOwner,
  upsertClipperOwnerChannel,
  deleteClipperOwnerChannel,
  type ClipperOwnerChannelRecord,
  type ClipperOwnerChannelUpsertInput,
  type ClipperOwnerRecord,
  type ClipperOwnerUpsertInput,
  type ClipperProjectSummary,
} from "../persistence/clipper-owner-db-api.util";
import { emitClipperOwnersChanged, onClipperOwnersChanged } from "../persistence/clipper-owner-events.util";
import { clipperError } from "../shared/logger.util";

export function useClipperOwners() {
  const [owners, setOwners] = useState<ClipperOwnerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const next = await fetchClipperOwners();
      setOwners(next);
    } catch (error) {
      clipperError("owners: refresh failed", error);
      setOwners([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    return onClipperOwnersChanged(() => {
      void refresh(false);
    });
  }, [refresh]);

  const saveOwner = useCallback(async (input: ClipperOwnerUpsertInput) => {
    const saved = await upsertClipperOwner(input);
    emitClipperOwnersChanged();
    return saved;
  }, []);

  const removeOwner = useCallback(async (ownerId: string) => {
    await deleteClipperOwner(ownerId);
    emitClipperOwnersChanged();
  }, []);

  const assignProjectOwner = useCallback(async (projectId: string, ownerId: string | null) => {
    await setClipperProjectOwner(projectId, ownerId);
    emitClipperOwnersChanged();
  }, []);

  const saveOwnerChannel = useCallback(async (input: ClipperOwnerChannelUpsertInput) => {
    const saved = await upsertClipperOwnerChannel(input);
    emitClipperOwnersChanged();
    return saved;
  }, []);

  const removeOwnerChannel = useCallback(async (channelId: string) => {
    await deleteClipperOwnerChannel(channelId);
    emitClipperOwnersChanged();
  }, []);

  const loadOwnerChannels = useCallback(async (ownerId: string): Promise<ClipperOwnerChannelRecord[]> => {
    return fetchClipperOwnerChannels(ownerId);
  }, []);

  const loadOwnerProjects = useCallback(async (ownerId: string): Promise<ClipperProjectSummary[]> => {
    return fetchClipperOwnerProjects(ownerId);
  }, []);

  return {
    owners,
    loading,
    refresh,
    saveOwner,
    removeOwner,
    assignProjectOwner,
    saveOwnerChannel,
    removeOwnerChannel,
    loadOwnerChannels,
    loadOwnerProjects,
  };
}
