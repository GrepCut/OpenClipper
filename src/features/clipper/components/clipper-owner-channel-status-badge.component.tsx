import React from "react";
import { Box } from "@chakra-ui/react";
import { colors } from "../../../theme";
import type { OwnerChannelAvailabilityStatus } from "../shared/clipper-owner-channels.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

interface ClipperOwnerChannelStatusBadgeProps {
  status: OwnerChannelAvailabilityStatus;
}

export function ClipperOwnerChannelStatusBadge({
  status,
}: ClipperOwnerChannelStatusBadgeProps) {
  const { theme, mode } = useClipperUi();
  const isAvailable = status === "available";

  return (
    <Box
      px={2.5}
      py={0.5}
      borderRadius="full"
      border={isAvailable ? "none" : "1px solid"}
      borderColor={isAvailable ? undefined : theme.dashboard.border}
      bg={
        isAvailable
          ? mode === "dark"
            ? theme.brand.purpleSoftAlpha12
            : theme.brand.toggleActiveBg
          : mode === "dark"
            ? theme.surface.active
            : "gray.100"
      }
      color={isAvailable ? colors.purple.medium : theme.text.muted}
      fontSize="xs"
      fontWeight="semibold"
      whiteSpace="nowrap"
      flexShrink={0}
    >
      {isAvailable ? "Available" : "Unavailable"}
    </Box>
  );
}
