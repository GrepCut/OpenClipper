import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";
import type { ClipperOwnerChannelRecord } from "../persistence/clipper-owner-db-api.util";

export interface AvailableOwnerChannel {
  platform: SocialPublishablePlatform;
  externalId: string;
  displayName: string;
  connectionId: string;
}

export function ownerChannelKey(channel: { platform: string; externalId: string }): string {
  return `${channel.platform}:${channel.externalId}`;
}

export function platformLabel(platform: string): string {
  if (platform === "x") return "X";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
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
    .map((linkedChannel) =>
      available.find(
        (item) =>
          item.platform === linkedChannel.platform &&
          item.externalId === linkedChannel.externalId,
      ),
    )
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

  (["facebook", "instagram", "tiktok", "x"] as const).forEach((platform) => {
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
