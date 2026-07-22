import React from "react";
import { Box, HStack, Progress, Text } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { clipperTheme } from "../shared/theme.util";

interface ClipperProgressBarProps {
  label: string;
  value: number;
  /** Optional trailing note (e.g. "~12s remaining") shown next to the percentage. */
  caption?: string;
}

export const ClipperProgressBar: React.FC<ClipperProgressBarProps> = ({
  label,
  value,
  caption,
}) => {
  const { theme } = useClipperUi();
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <Box w="full">
      <HStack justify="space-between" mb={2}>
        <Text fontSize="sm" color={theme.text.muted}>
          {label}
        </Text>
        <HStack gap={2}>
          {caption && (
            <Text fontSize="sm" color={theme.text.muted}>
              {caption}
            </Text>
          )}
          <Text fontSize="sm" color={clipperTheme.accentLight}>
            {percent}%
          </Text>
        </HStack>
      </HStack>
      <Progress.Root value={percent} size="sm">
        <Progress.Track bg={theme.surface.hover} borderRadius="full">
          <Progress.Range
            bg={`linear-gradient(90deg, ${clipperTheme.gradientFrom}, ${clipperTheme.gradientTo})`}
            borderRadius="full"
          />
        </Progress.Track>
      </Progress.Root>
    </Box>
  );
};
