import type { SocialConnectionSummary, SocialPublishablePlatform } from "../../../services/types/social-auth.types";
import type { ClipperOwnerChannelRecord } from "../persistence/clipper-owner-db-api.util";

export interface AvailableOwnerChannel {
  platform: SocialPublishablePlatform;
  externalId: string;
  displayName: string;
  connectionId: string;
}

export type OwnerChannelAvailabilityStatus = "available" | "unavailable";

export interface ResolvedOwnerChannel {
  linked: ClipperOwnerChannelRecord;
  displayName: string;
  status: OwnerChannelAvailabilityStatus;
  connectionId: string | null;
  matchedConnection: SocialConnectionSummary | null;
}

export interface ManageChannelRow {
  key: string;
  platform: SocialPublishablePlatform;
  displayName: string;
  status: OwnerChannelAvailabilityStatus;
  available: AvailableOwnerChannel | null;
  linked: ClipperOwnerChannelRecord | null;
  isOrphan: boolean;
}

export interface OwnerPublishConnectionResult {
  connected: boolean;
  accountLabel: string | null;
  accountConnections: SocialConnectionSummary[];
  ownerChannelLabel: string | null;
}

export function ownerChannelKey(channel: { platform: string; externalId: string }): string {
  return `${channel.platform}:${channel.externalId}`;
}

export function platformLabel(platform: string): string {
  if (platform === "x") return "X";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function connectionExternalId(connection: SocialConnectionSummary): string {
  return connection.externalAccountId ?? connection.id;
}

export function ownerChannelMatchesConnection(
  linked: Pick<ClipperOwnerChannelRecord, "externalId">,
  connection: SocialConnectionSummary,
): boolean {
  const externalId = connectionExternalId(connection);
  return linked.externalId === externalId || linked.externalId === connection.id;
}

export function findConnectionForOwnerChannel(
  linked: Pick<ClipperOwnerChannelRecord, "platform" | "externalId">,
  available: AvailableOwnerChannel[],
): AvailableOwnerChannel | null {
  return (
    available.find(
      (item) =>
        item.platform === linked.platform &&
        (item.externalId === linked.externalId || item.connectionId === linked.externalId),
    ) ?? null
  );
}

export function findSocialConnectionForOwnerChannel(
  linked: Pick<ClipperOwnerChannelRecord, "platform" | "externalId">,
  connections: SocialConnectionSummary[],
): SocialConnectionSummary | null {
  return (
    connections.find((connection) => ownerChannelMatchesConnection(linked, connection)) ?? null
  );
}

export function resolveOwnerChannels(
  linked: ClipperOwnerChannelRecord[],
  available: AvailableOwnerChannel[],
): ResolvedOwnerChannel[] {
  return linked.map((channel) => {
    const match = findConnectionForOwnerChannel(channel, available);
    return {
      linked: channel,
      displayName: match?.displayName ?? channel.displayName,
      status: match ? "available" : "unavailable",
      connectionId: match?.connectionId ?? null,
      matchedConnection: match
        ? {
            id: match.connectionId,
            displayName: match.displayName,
            externalAccountId: match.externalId,
          }
        : null,
    };
  });
}

export function buildManageChannelRows(
  linked: ClipperOwnerChannelRecord[],
  available: AvailableOwnerChannel[],
): ManageChannelRow[] {
  const rows: ManageChannelRow[] = [];
  const matchedLinkedIds = new Set<string>();

  for (const item of available) {
    const linkedChannel =
      linked.find(
        (channel) =>
          channel.platform === item.platform &&
          (channel.externalId === item.externalId || channel.externalId === item.connectionId),
      ) ?? null;
    if (linkedChannel) {
      matchedLinkedIds.add(linkedChannel.id);
    }
    rows.push({
      key: ownerChannelKey(item),
      platform: item.platform,
      displayName: item.displayName,
      status: "available",
      available: item,
      linked: linkedChannel,
      isOrphan: false,
    });
  }

  for (const channel of linked) {
    if (matchedLinkedIds.has(channel.id)) continue;
    rows.push({
      key: `orphan:${channel.id}`,
      platform: channel.platform as SocialPublishablePlatform,
      displayName: channel.displayName,
      status: "unavailable",
      available: null,
      linked: channel,
      isOrphan: true,
    });
  }

  return rows.sort((a, b) => platformLabel(a.platform).localeCompare(platformLabel(b.platform)));
}

export function ownerChannelsNeedingDisplayNameSync(
  resolved: ResolvedOwnerChannel[],
): ResolvedOwnerChannel[] {
  return resolved.filter(
    (item) =>
      item.status === "available" &&
      item.displayName.trim() !== item.linked.displayName.trim(),
  );
}

export interface OwnerChannelSelectionDiff {
  toAdd: AvailableOwnerChannel[];
  toRemove: ClipperOwnerChannelRecord[];
}

export function diffOwnerChannelSelection(
  linked: ClipperOwnerChannelRecord[],
  selected: AvailableOwnerChannel[],
): OwnerChannelSelectionDiff {
  const selectedByPlatform = new Map<string, AvailableOwnerChannel>();
  for (const channel of selected) {
    selectedByPlatform.set(channel.platform, channel);
  }

  const linkedByPlatform = new Map<string, ClipperOwnerChannelRecord>();
  for (const channel of linked) {
    linkedByPlatform.set(channel.platform, channel);
  }

  const toAdd: AvailableOwnerChannel[] = [];
  const toRemove: ClipperOwnerChannelRecord[] = [];

  for (const [platform, selectedChannel] of selectedByPlatform) {
    const existing = linkedByPlatform.get(platform);
    if (!existing || existing.externalId !== selectedChannel.externalId) {
      toAdd.push(selectedChannel);
    }
  }

  for (const [platform, linkedChannel] of linkedByPlatform) {
    const selectedChannel = selectedByPlatform.get(platform);
    if (!selectedChannel || selectedChannel.externalId !== linkedChannel.externalId) {
      toRemove.push(linkedChannel);
    }
  }

  return { toAdd, toRemove };
}

export function linkedChannelsToSelection(
  linked: ClipperOwnerChannelRecord[],
  available: AvailableOwnerChannel[],
): AvailableOwnerChannel[] {
  return linked
    .map((linkedChannel) => findConnectionForOwnerChannel(linkedChannel, available))
    .filter((item): item is AvailableOwnerChannel => item != null);
}

export function buildAvailableOwnerChannels(input: {
  youtubeConnections: Array<{
    id: string;
    displayName: string | null;
    externalAccountId: string | null;
  }>;
  socialPlatforms: Record<
    SocialPublishablePlatform,
    {
      connections: Array<{
        id: string;
        displayName: string | null;
        externalAccountId: string | null;
      }>;
    }
  >;
}): AvailableOwnerChannel[] {
  const channels: AvailableOwnerChannel[] = [];

  for (const connection of input.youtubeConnections) {
    channels.push({
      platform: "youtube",
      connectionId: connection.id,
      externalId: connection.externalAccountId ?? connection.id,
      displayName: connection.displayName?.trim() || "YouTube",
    });
  }

  (["facebook", "instagram", "threads", "tiktok", "x"] as const).forEach((platform) => {
    for (const connection of input.socialPlatforms[platform]?.connections ?? []) {
      channels.push({
        platform,
        connectionId: connection.id,
        externalId: connection.externalAccountId ?? connection.id,
        displayName: connection.displayName?.trim() || platform,
      });
    }
  });

  return channels;
}

export function resolvePublishConnectionsForOwner(input: {
  platform: SocialPublishablePlatform;
  ownerChannels: ClipperOwnerChannelRecord[];
  availableChannels: AvailableOwnerChannel[];
  youtubeConnections: SocialConnectionSummary[];
  socialPlatforms: Record<
    SocialPublishablePlatform,
    { connections: SocialConnectionSummary[] }
  >;
}): OwnerPublishConnectionResult {
  const linked = input.ownerChannels.find((channel) => channel.platform === input.platform) ?? null;
  if (!linked) {
    return {
      connected: false,
      accountLabel: null,
      accountConnections: [],
      ownerChannelLabel: null,
    };
  }

  const availableMatch = findConnectionForOwnerChannel(linked, input.availableChannels);
  const platformConnections =
    input.platform === "youtube"
      ? input.youtubeConnections
      : input.socialPlatforms[input.platform]?.connections ?? [];

  const matched =
    availableMatch != null
      ? platformConnections.find((connection) => connection.id === availableMatch.connectionId) ??
        findSocialConnectionForOwnerChannel(linked, platformConnections)
      : findSocialConnectionForOwnerChannel(linked, platformConnections);

  if (!matched) {
    return {
      connected: false,
      accountLabel: linked.displayName,
      accountConnections: [],
      ownerChannelLabel: linked.displayName,
    };
  }

  return {
    connected: true,
    accountLabel: matched.displayName ?? linked.displayName,
    accountConnections: [matched],
    ownerChannelLabel: matched.displayName ?? linked.displayName,
  };
}
