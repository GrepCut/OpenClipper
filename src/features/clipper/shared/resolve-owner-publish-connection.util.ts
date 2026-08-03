import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";
import { appToast } from "../../../shared/utils/toast.service";
import {
  fetchClipperOwnerChannels,
  fetchClipperProjectOwnerId,
} from "../persistence/clipper-owner-db-api.util";
import {
  buildAvailableOwnerChannels,
  resolvePublishConnectionsForOwner,
  type OwnerPublishConnectionResult,
} from "./clipper-owner-channels.util";
import { platformLabel } from "./clipper-owner-channels.util";

export async function resolveOwnerPublishConnection(input: {
  ownerId: string | null | undefined;
  platform: SocialPublishablePlatform;
  youtubeConnections: Array<{
    id: string;
    displayName: string | null;
    externalAccountId: string | null;
  }>;
  socialPlatforms: Parameters<typeof buildAvailableOwnerChannels>[0]["socialPlatforms"];
}): Promise<OwnerPublishConnectionResult | null> {
  if (!input.ownerId) return null;

  const [ownerChannels, availableChannels] = await Promise.all([
    fetchClipperOwnerChannels(input.ownerId),
    Promise.resolve(
      buildAvailableOwnerChannels({
        youtubeConnections: input.youtubeConnections,
        socialPlatforms: input.socialPlatforms,
      }),
    ),
  ]);

  return resolvePublishConnectionsForOwner({
    platform: input.platform,
    ownerChannels,
    availableChannels,
    youtubeConnections: input.youtubeConnections,
    socialPlatforms: input.socialPlatforms,
  });
}

export function getOwnerPublishBlockedMessage(
  platform: SocialPublishablePlatform,
  result: OwnerPublishConnectionResult,
): string | null {
  if (result.connected) return null;

  if (!result.ownerChannelLabel && result.accountConnections.length === 0) {
    return `Link a ${platformLabel(platform)} channel for this owner in the Owners tab.`;
  }

  return `${result.ownerChannelLabel ?? "The linked channel"} is not connected. Reconnect it in Integrations or update Manage channels.`;
}

export function showOwnerPublishBlockedToast(
  platform: SocialPublishablePlatform,
  result: OwnerPublishConnectionResult,
): boolean {
  const message = getOwnerPublishBlockedMessage(platform, result);
  if (!message) return false;

  const title =
    !result.ownerChannelLabel && result.accountConnections.length === 0
      ? "Channel not linked"
      : "Channel unavailable";
  appToast.error(title, message);
  return true;
}

export async function resolveProjectOwnerPublishConnection(input: {
  projectId: string;
  platform: SocialPublishablePlatform;
  youtubeConnections: Array<{
    id: string;
    displayName: string | null;
    externalAccountId: string | null;
  }>;
  socialPlatforms: Parameters<typeof buildAvailableOwnerChannels>[0]["socialPlatforms"];
}): Promise<OwnerPublishConnectionResult | null> {
  const ownerId = await fetchClipperProjectOwnerId(input.projectId);
  if (!ownerId) return null;
  return resolveOwnerPublishConnection({
    ownerId,
    platform: input.platform,
    youtubeConnections: input.youtubeConnections,
    socialPlatforms: input.socialPlatforms,
  });
}
