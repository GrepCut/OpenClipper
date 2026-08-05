import React from "react";
import { Youtube, Instagram, Facebook } from "lucide-react";
import type { SocialPrivacyStatus, SocialPublishablePlatform } from "../../../services/social-auth.service";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

export const PRIVACY_OPTIONS: { value: SocialPrivacyStatus; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

export const PLATFORM_LABELS: Record<SocialPublishablePlatform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  x: "X",
};

export function PlatformIcon({ platform }: { platform: SocialPublishablePlatform }) {
  switch (platform) {
    case "youtube":
      return <Youtube size={20} color="#FF0000" />;
    case "instagram":
      return <Instagram size={20} />;
    case "facebook":
      return <Facebook size={20} />;
    case "threads":
      return <ClipperPlatformIcon platform="threads" size={20} />;
    case "tiktok":
      return <ClipperPlatformIcon platform="tiktok" size={20} />;
    case "x":
      return <ClipperPlatformIcon platform="twitter" size={20} />;
    default:
      return <Youtube size={20} />;
  }
}

export interface ClipperSocialPublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  result: import("../shared/state.util").ClipperFormatResult | null;
  sourceFileName: string | null;
  defaultConnected: boolean;
  accountLabel: string | null;
  accountConnections: Array<{
    id: string;
    displayName: string | null;
    externalAccountId: string | null;
    googleEmail?: string | null;
  }>;
  ownerChannelLabel?: string | null;
  publishPlatform?: SocialPublishablePlatform;
  onRequestConnect: (platform: SocialPublishablePlatform) => void;
  onPublishComplete?: (record: import("../persistence/clipper-export-db-api.util").ClipperExportPublishRecord) => void;
}
