import React from "react";
import { Box } from "@chakra-ui/react";
import { Facebook } from "lucide-react";
import type { ClipperPlatform } from "../shared/formats.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

function toClipperPlatform(platform: string): ClipperPlatform | null {
  if (platform === "x") return "twitter";
  if (platform === "youtube" || platform === "instagram" || platform === "tiktok" || platform === "twitter") {
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
  const { theme } = useClipperUi();

  if (platform === "facebook") {
    return (
      <Box flexShrink={0} color={theme.text.muted}>
        <Facebook size={size} />
      </Box>
    );
  }

  const clipperPlatform = toClipperPlatform(platform);
  if (!clipperPlatform) {
    return null;
  }

  return <ClipperPlatformIcon platform={clipperPlatform} size={size} />;
}
