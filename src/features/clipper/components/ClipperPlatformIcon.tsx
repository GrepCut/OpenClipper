import React from "react";
import { Box, type BoxProps } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui";
import type { ClipperPlatform } from "../shared/formats";
import { asset } from "../../../shared/utils/asset";

export const CLIPPER_PLATFORM_BADGE_SIZE = 44;
/** Top inset so the floating badge is not clipped by scroll containers */
export const CLIPPER_CARD_BADGE_INSET = CLIPPER_PLATFORM_BADGE_SIZE / 2 + 6;

const PLATFORM_LOGO: Record<ClipperPlatform, string> = {
  youtube: asset("/clipper/youtube-logo.webp"),
  instagram: asset("/clipper/instagram-logo.webp"),
  tiktok: asset("/clipper/tiktok-logo.webp"),
  twitter: asset("/clipper/x-logo.webp"),
  linkedin: asset("/clipper/linkedin-logo.webp"),
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
      <Box
        as="img"
        src={PLATFORM_LOGO[platform]}
        alt=""
        aria-hidden
        w={`${size}px`}
        h={`${size}px`}
        objectFit="cover"
        display="block"
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
