import React from "react";
import { Box } from "@chakra-ui/react";
import {
  getBadgePlatformsForFormat,
  getClipperCardFrameSize,
  type ClipperPlatform,
} from "../shared/formats.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  ClipperMultiPlatformBadge,
  ClipperPlatformBadge,
  CLIPPER_CARD_BADGE_INSET,
} from "./clipper-platform-icon.component";

interface ClipperFormatCardProps {
  formatId: string;
  platform: ClipperPlatform;
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Override card frame height (default: CLIPPER_CARD_FRAME_HEIGHT). */
  frameHeight?: number;
}

export const ClipperFormatCard: React.FC<ClipperFormatCardProps> = ({
  formatId,
  platform,
  label,
  children,
  footer,
  frameHeight,
}) => {
  const { theme } = useClipperUi();
  const frame = getClipperCardFrameSize(formatId, frameHeight);
  const badgePlatforms = getBadgePlatformsForFormat(formatId);
  const platforms = badgePlatforms.length > 0 ? badgePlatforms : [platform];

  return (
    <Box
      position="relative"
      flexShrink={0}
      pt={`${CLIPPER_CARD_BADGE_INSET}px`}
      w={`${frame.width}px`}
    >
      <Box
        w={`${frame.width}px`}
        h={`${frame.height}px`}
        borderRadius="2xl"
        overflow="hidden"
        bg={theme.background.surface}
        border="1px solid"
        borderColor={theme.surface.hover}
        boxShadow={theme.shadow.panel}
        position="relative"
        zIndex={1}
        aria-label={label}
      >
        <Box w="100%" h="100%" display="flex" alignItems="stretch" justifyContent="stretch">
          {children}
        </Box>
      </Box>

      {platforms.length > 1 ? (
        <ClipperMultiPlatformBadge platforms={platforms} top={`${CLIPPER_CARD_BADGE_INSET}px`} />
      ) : (
        <ClipperPlatformBadge platform={platforms[0]!} top={`${CLIPPER_CARD_BADGE_INSET}px`} />
      )}

      {footer ? <Box mt={3} w={`${frame.width}px`}>{footer}</Box> : null}
    </Box>
  );
};
