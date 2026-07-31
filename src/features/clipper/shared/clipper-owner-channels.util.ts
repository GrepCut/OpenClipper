import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";

export interface AvailableOwnerChannel {
  platform: SocialPublishablePlatform;
  externalId: string;
  displayName: string;
  connectionId: string;
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
