import React, { useMemo } from "react";
import { Box, Progress, Text, VStack } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  visibleBootSteps,
  type ClipperLoadingStatus,
  type ClipperLoadingStep,
} from "../shared/loading-status.util";

interface ClipperProjectLoadingPanelProps {
  status: ClipperLoadingStatus;
}

function progressPercent(steps: ClipperLoadingStep[] | undefined): number {
  const visible = visibleBootSteps(steps ?? []);
  if (visible.length === 0) return 15;
  const doneCount = visible.filter((step) => step.status === "done").length;
  const hasActive = visible.some((step) => step.status === "active");
  const base = (doneCount / visible.length) * 100;
  if (hasActive) {
    return Math.max(base + 100 / visible.length / 2, 15);
  }
  return Math.max(base, doneCount > 0 ? 100 : 15);
}

export const ClipperProjectLoadingPanel: React.FC<ClipperProjectLoadingPanelProps> = ({
  status,
}) => {
  const { theme } = useClipperUi();
  const visibleSteps = useMemo(
    () => (status.steps ? visibleBootSteps(status.steps) : []),
    [status.steps],
  );
  const percent = useMemo(() => progressPercent(visibleSteps), [visibleSteps]);

  return (
    <VStack gap={5} align="stretch" maxW="400px" mx="auto" px={4} w="full">
      <Box w="full">
        <Progress.Root value={percent} size="sm">
          <Progress.Track bg={theme.surface.hover} borderRadius="full">
            <Progress.Range
              bg={`linear-gradient(90deg, ${clipperTheme.gradientFrom}, ${clipperTheme.gradientTo})`}
              borderRadius="full"
              transition="width 0.3s ease"
            />
          </Progress.Track>
        </Progress.Root>
      </Box>

      {visibleSteps.length > 0 ? (
        <VStack align="stretch" gap={1}>
          {visibleSteps.map((step) => (
            <Text
              key={step.id}
              fontSize="sm"
              lineHeight="1.5"
              color={
                step.status === "pending"
                  ? theme.text.disabled
                  : step.status === "active"
                    ? theme.text.primary
                    : theme.text.muted
              }
              fontWeight={step.status === "active" ? "semibold" : "normal"}
            >
              {step.label}
            </Text>
          ))}
        </VStack>
      ) : (
        <Text fontSize="sm" color={theme.text.primary} fontWeight="semibold" textAlign="center">
          {status.message}
        </Text>
      )}
    </VStack>
  );
};
