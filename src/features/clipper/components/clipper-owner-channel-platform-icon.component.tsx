import React from "react";
import type { ClipperPlatform } from "../shared/formats.util";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

function toClipperPlatform(platform: string): ClipperPlatform | null {
  if (platform === "x") return "twitter";
  if (
    platform === "youtube" ||
    platform === "instagram" ||
    platform === "tiktok" ||
    platform === "twitter" ||
    platform === "threads" ||
    platform === "youtube-shorts" ||
    platform === "facebook"
  ) {
    return platform;
  }
  return null;
}

export function ClipperOwnerChannelPlatformIcon({
  platform,
  size = 20,
}: {
  platform: string;
  size?: number;
}) {
  const clipperPlatform = toClipperPlatform(platform);
  if (!clipperPlatform) {
    return null;
  }

  return <ClipperPlatformIcon platform={clipperPlatform} size={size} />;
}
