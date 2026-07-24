import React from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { FormatRenderStatus } from "../shared/render-progress.util";
import type { ClipperPlatform } from "../shared/formats.util";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

const PROGRESS_RING_SIZE = 20;
const PROGRESS_RING_STROKE = 2.5;

function FormatProgressRing({ progress }: { progress: number }) {
  const { theme } = useClipperUi();
  const radius = (PROGRESS_RING_SIZE - PROGRESS_RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = circumference * (1 - clamped);
  const center = PROGRESS_RING_SIZE / 2;

  return (
    <Box
      asChild
      flexShrink={0}
      transform="rotate(-90deg)"
      aria-hidden
    >
      <svg
        width={PROGRESS_RING_SIZE}
        height={PROGRESS_RING_SIZE}
        viewBox={`0 0 ${PROGRESS_RING_SIZE} ${PROGRESS_RING_SIZE}`}
      >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={theme.surface.hover}
        strokeWidth={PROGRESS_RING_STROKE}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={clipperTheme.accentLight}
        strokeWidth={PROGRESS_RING_STROKE}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
      </svg>
    </Box>
  );
}

interface ClipperRenderFormatProgressRowProps {
  formatLabel: string;
  platform: ClipperPlatform;
  clipLabel: string;
  clipTimeRange: string;
  status: FormatRenderStatus;
  formatProgress: number | null;
}

function statusLabel(status: FormatRenderStatus, formatProgress: number | null): string {
  switch (status) {
    case "done":
      return "Done";
    case "rendering":
      return formatProgress != null ? `${Math.round(formatProgress * 100)}%` : "Rendering…";
    case "error":
      return "Failed";
    case "queued":
      return "Queued";
    case "starting":
      return "Preparing…";
    default:
      return "Waiting";
  }
}

export const ClipperRenderFormatProgressRow: React.FC<ClipperRenderFormatProgressRowProps> = ({
  formatLabel,
  platform,
  clipLabel,
  clipTimeRange,
  status,
  formatProgress,
}) => {
  const { theme } = useClipperUi();

  return (
    <HStack
      gap={3}
      p={3}
      borderRadius="xl"
      border="1px solid"
      borderColor={theme.surface.hover}
      bg={
        status === "rendering" || status === "starting"
          ? `rgba(${clipperTheme.accentTintRgb},0.1)`
          : theme.surface.faint
      }
    >
      {status === "done" ? (
        <Box flexShrink={0}>
          <CheckCircle2 size={20} color={clipperTheme.accentLight} />
        </Box>
      ) : status === "rendering" || status === "starting" ? (
        <FormatProgressRing progress={formatProgress ?? 0} />
      ) : status === "error" ? (
        <Box flexShrink={0}>
          <AlertCircle size={20} color={theme.status.danger} />
        </Box>
      ) : (
        <Box flexShrink={0}>
          <Circle size={20} color={theme.text.toggleThumbInactive} />
        </Box>
      )}

      <Box flexShrink={0}>
        <ClipperPlatformIcon platform={platform} size={20} />
      </Box>

      <VStack align="start" gap={0} flex={1} minW={0}>
        <Text color={theme.text.primary} fontWeight="semibold" fontSize="sm" lineClamp={1}>
          {formatLabel}
          <Text as="span" fontWeight="normal" color={theme.text.muted} ml={2}>
            {clipLabel}
            <Text as="span" ml={1}>
              {clipTimeRange}
            </Text>
          </Text>
        </Text>
        <Text fontSize="xs" color={theme.text.muted}>
          {statusLabel(status, formatProgress)}
        </Text>
      </VStack>

      {status === "rendering" && formatProgress != null && (
        <Text fontSize="sm" color={clipperTheme.accentLight} fontWeight="semibold">
          {Math.round(formatProgress * 100)}%
        </Text>
      )}
    </HStack>
  );
};
