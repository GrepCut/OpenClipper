import React from "react";
import { Box, HStack, type BoxProps } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperPlatform } from "../shared/formats.util";
import { asset } from "../../../shared/utils/asset.util";

export const CLIPPER_PLATFORM_BADGE_SIZE = 44;
/** Top inset so the floating badge is not clipped by scroll containers */
export const CLIPPER_CARD_BADGE_INSET = CLIPPER_PLATFORM_BADGE_SIZE / 2 + 6;

const PLATFORM_LOGO: Record<ClipperPlatform, string> = {
  youtube: asset("/clipper/youtube-logo.webp"),
  "youtube-shorts": asset("/clipper/youtube-shorts-logo.webp"),
  instagram: asset("/clipper/instagram-logo.webp"),
  tiktok: asset("/clipper/tiktok-logo.webp"),
  twitter: asset("/clipper/x-logo.webp"),
  threads: asset("/clipper/threads-logo.webp"),
};

const PLATFORM_LOGO_FIT: Record<ClipperPlatform, "cover" | "contain"> = {
  youtube: "cover",
  "youtube-shorts": "contain",
  instagram: "cover",
  tiktok: "cover",
  twitter: "cover",
  threads: "cover",
};

function ClipperPlatformLogoCircle({
  platform,
  size,
  ...boxProps
}: {
  platform: ClipperPlatform;
  size: number;
} & BoxProps) {
  const { theme } = useClipperUi();
  const fit = PLATFORM_LOGO_FIT[platform];

  return (
    <Box
      w={`${size}px`}
      h={`${size}px`}
      minW={`${size}px`}
      minH={`${size}px`}
      flexShrink={0}
      borderRadius={`${Math.round(size * 0.22)}px`}
      overflow="hidden"
      boxShadow={theme.shadow.dropdown}
      {...boxProps}
    >
      <img
        src={PLATFORM_LOGO[platform]}
        alt=""
        aria-hidden
        width={size}
        height={size}
        style={{ objectFit: fit, display: "block", width: "100%", height: "100%" }}
        draggable={false}
      />
    </Box>
  );
}

export function ClipperPlatformIcon({
  platform,
  size = CLIPPER_PLATFORM_BADGE_SIZE,
}: {
  platform: ClipperPlatform;
  size?: number;
}) {
  return <ClipperPlatformLogoCircle platform={platform} size={size} />;
}

export function ClipperPlatformBadge({
  platform,
  top = 0,
}: {
  platform: ClipperPlatform;
  top?: number | string;
}) {
  return (
    <ClipperPlatformLogoCircle
      platform={platform}
      size={CLIPPER_PLATFORM_BADGE_SIZE}
      position="absolute"
      top={top}
      left="50%"
      transform="translate(-50%, -50%)"
      zIndex={3}
    />
  );
}

/** Dual (or multi) platform badge for merged export formats. */
export function ClipperMultiPlatformBadge({
  platforms,
  top = 0,
}: {
  platforms: ClipperPlatform[];
  top?: number | string;
}) {
  if (platforms.length === 0) return null;
  if (platforms.length === 1) {
    return <ClipperPlatformBadge platform={platforms[0]!} top={top} />;
  }

  const size = Math.round(CLIPPER_PLATFORM_BADGE_SIZE * 0.82);
  const overlap = Math.round(size * 0.28);

  return (
    <HStack
      position="absolute"
      top={top}
      left="50%"
      transform="translate(-50%, -50%)"
      zIndex={3}
      gap={0}
      pointerEvents="none"
    >
      {platforms.map((platform, index) => (
        <Box key={`${platform}-${index}`} ml={index === 0 ? 0 : `-${overlap}px`} zIndex={platforms.length - index}>
          <ClipperPlatformLogoCircle platform={platform} size={size} />
        </Box>
      ))}
    </HStack>
  );
}
