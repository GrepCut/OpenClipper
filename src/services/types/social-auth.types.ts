export type SocialPublishablePlatform =
  | "youtube"
  | "facebook"
  | "instagram"
  | "threads"
  | "tiktok"
  | "x";

export type SocialOAuthFlow =
  | "youtube"
  | "meta"
  | "instagram"
  | "threads"
  | "tiktok"
  | "x";

export type SocialPublishJobStatus =
  | "pending"
  | "uploading"
  | "processing"
  | "published"
  | "failed";

export type SocialPrivacyStatus = "private" | "unlisted" | "public";

export interface SocialConnectionSummary {
  id: string;
  displayName: string | null;
  externalAccountId: string | null;
  googleEmail?: string | null;
}

export interface SocialStatusResponse {
  connections: SocialConnectionSummary[];
  connected: boolean;
  displayName?: string;
  reason?: string;
}

export interface SocialDisconnectResponse {
  disconnected: boolean;
}

export interface MetaPublishTarget {
  id: string;
  name: string;
  instagramUserId: string | null;
}

export interface MetaTargetsResponse {
  selectionRequired: boolean;
  profileName: string | null;
  targets: MetaPublishTarget[];
  metaConnectionId: string | null;
}

export interface SocialPublishResponse {
  jobId: string;
  status: SocialPublishJobStatus;
  externalId?: string;
  watchUrl?: string;
}

export interface SocialPublishJobStatusResponse {
  id: string;
  platform: string;
  status: SocialPublishJobStatus;
  externalId: string | null;
  watchUrl: string | null;
  error: string | null;
  title: string;
  clipIndex: number;
  formatId: string;
}

export interface PublishClipperToSocialParams {
  platform: SocialPublishablePlatform;
  connectionId?: string;
  projectId: string;
  exportId: string;
  video: File;
  clipIndex: number;
  formatId: string;
  title: string;
  description?: string;
  privacyStatus: SocialPrivacyStatus;
  expectedFileSize?: number;
  onUploadProgress?: (progress: number) => void;
  onUploadPhaseChange?: (phase: "uploading" | "publishing") => void;
}

export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export interface TikTokCreatorInfo {
  nickname?: string;
  username?: string;
  avatarUrl?: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec?: number;
  canPost: boolean;
  blockerCode?: string;
  blockerMessage?: string;
}

export interface TikTokPostOptions {
  caption: string;
  privacyLevel: TikTokPrivacyLevel;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
  isAigc: boolean;
  musicUsageConfirmed: boolean;
  durationSeconds: number;
}

export interface PublishClipperToTikTokParams {
  projectId: string;
  exportId: string;
  connectionId?: string;
  clipIndex: number;
  formatId: string;
  video: File;
  options: TikTokPostOptions;
  onUploadProgress?: (progress: number) => void;
  onUploadPhaseChange?: (phase: "uploading" | "publishing") => void;
}

/**
 * Map Clipper format.platform → publish API platform.
 * Multi-target formats (vertical-short / vertical-reels) return null —
 * the publish UI must pick an explicit target.
 */
export function publishPlatformForFormat(
  formatPlatform: string,
): SocialPublishablePlatform | null {
  switch (formatPlatform) {
    case "youtube":
    case "youtube-shorts":
      return "youtube";
    case "instagram":
      return "instagram";
    case "threads":
      return "threads";
    case "tiktok":
      return "tiktok";
    case "twitter":
      return "x";
    case "vertical-short":
    case "vertical-reels":
      return null;
    default:
      return null;
  }
}

/** OAuth flow used to connect a publish platform. */
export function oauthFlowForPlatform(
  platform: SocialPublishablePlatform,
): SocialOAuthFlow {
  if (platform === "facebook") return "meta";
  if (platform === "instagram") return "instagram";
  if (platform === "threads") return "threads";
  if (platform === "youtube") return "youtube";
  return platform;
}
