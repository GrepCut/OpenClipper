import { useMemo } from "react";
import { Box, Grid, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { getOutlinedActionSurfaceProps } from "../../../shared/components/buttons/outlined-action-button.component";
import { colors, useTheme, type Theme } from "../../../theme";
import type { BenchmarkResult, BenchmarkRun, BenchmarkRunStatus, TestClip } from "../test.types";

function mse(value: number | null | undefined): string {
  return value == null ? "—" : value.toExponential(3);
}

function runStatusPill(status: BenchmarkRunStatus, theme: Theme, mode: "dark" | "light") {
  if (status === "completed") {
    return {
      bg: mode === "dark" ? theme.brand.purpleSoftAlpha12 : theme.brand.toggleActiveBg,
      color: colors.purple.medium,
    };
  }
  if (status === "failed") {
    return {
      bg: theme.interactive.destructiveHover,
      color: theme.status.danger,
    };
  }
  return {
    bg: mode === "dark" ? theme.background.secondary : theme.background.tertiary,
    color: theme.text.muted,
  };
}

interface BenchmarkRunsPanelProps {
  runs: BenchmarkRun[];
  selectedRunId: string | null;
  rememberedRunId: string | null;
  onSelectRun: (runId: string) => void;
  results: BenchmarkResult[];
  clips: TestClip[];
}

const RESULT_COLUMNS = "minmax(120px, 2fr) repeat(3, minmax(72px, 1fr))";

export function BenchmarkRunsPanel({
  runs,
  selectedRunId,
  rememberedRunId,
  onSelectRun,
  results,
  clips,
}: BenchmarkRunsPanelProps) {
  const { theme, mode } = useTheme();

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const primaryResults = useMemo(
    () => results,
    [results],
  );
  const aggregateMse = useMemo(() => {
    const values = primaryResults.map((result) => result.metricsJson.mse).filter((value): value is number => typeof value === "number");
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [primaryResults]);

  return (
    <SimpleGrid columns={{ base: 1, xl: 2 }} gap={5}>
      <Box>
        <Text fontSize="xl" fontWeight="bold" mb={3}>Run history</Text>
        <VStack align="stretch" gap={2}>
          {runs.length === 0 ? (
            <Text color={theme.text.muted}>No runs yet.</Text>
          ) : runs.map((run) => {
            const isSelected = selectedRunId === run.id;
            const pill = runStatusPill(run.status, theme, mode);
            const isRemembered = run.id === rememberedRunId;
            return (
              <Box
                key={run.id}
                as="button"
                w="full"
                textAlign="left"
                p={4}
                borderRadius="2xl"
                cursor="pointer"
                color={theme.text.primary}
                {...getOutlinedActionSurfaceProps(theme, isSelected)}
                onClick={() => onSelectRun(run.id)}
              >
                <HStack justify="space-between" gap={3}>
                  <Text fontSize="sm" color={theme.text.primary}>
                    {new Date(run.createdAt).toLocaleString()}
                  </Text>
                  <HStack gap={2}>
                    {isRemembered ? (
                      <Box
                        px={2}
                        py={0.5}
                        borderRadius="full"
                        bg={mode === "dark" ? theme.background.secondary : theme.background.tertiary}
                        color={theme.text.muted}
                        fontSize="xs"
                        fontWeight="semibold"
                      >
                        Baseline
                      </Box>
                    ) : null}
                    <Box
                      px={2}
                      py={0.5}
                      borderRadius="full"
                      bg={pill.bg}
                      color={pill.color}
                      fontSize="xs"
                      fontWeight="semibold"
                      textTransform="capitalize"
                      flexShrink={0}
                    >
                      {run.status}
                    </Box>
                  </HStack>
                </HStack>
                {run.error ? (
                  <Text fontSize="xs" color={theme.status.danger} mt={1}>
                    {run.error}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </VStack>
      </Box>

      <Box>
        <Text fontSize="xl" fontWeight="bold" mb={3}>Selected run</Text>
        <Box
          border="1px solid"
          borderColor={theme.dashboard.border}
          borderRadius="2xl"
          bg={theme.background.card}
          overflowX="auto"
        >
          {primaryResults.length === 0 ? (
            <Text color={theme.text.muted} fontSize="sm" p={5}>
              {selectedRunId ? "No crop results for this run." : "Select a run to view results."}
            </Text>
          ) : (
            <Box minW="520px">
              <Grid
                templateColumns={RESULT_COLUMNS}
                gap={3}
                px={4}
                py={3}
                bg={theme.background.tertiary}
                borderTopRadius="2xl"
              >
                {["Clip", "Frames", "MSE", "Status"].map((label) => (
                  <Text key={label} color={theme.text.muted} fontSize="xs" fontWeight="semibold">
                    {label}
                  </Text>
                ))}
              </Grid>
              {primaryResults.map((result, index) => {
                const clip = clips.find((candidate) => candidate.id === result.clipId);
                const isLast = index === primaryResults.length - 1;
                const checked = result.metricsJson.matchesBaseline != null;
                return (
                  <Grid
                    key={result.id}
                    templateColumns={RESULT_COLUMNS}
                    gap={3}
                    px={4}
                    py={3}
                    alignItems="center"
                    bg={theme.background.card}
                    color={theme.text.primary}
                    borderBottom={isLast ? "none" : "1px solid"}
                    borderColor={theme.dashboard.border}
                    borderBottomRadius={isLast ? "2xl" : undefined}
                  >
                    <Text fontSize="sm" color={theme.text.primary}>{clip?.name ?? result.clipId} · {result.aspectId}</Text>
                    <Text fontSize="sm" color={theme.text.primary}>
                      {checked
                        ? result.metricsJson.comparedFrames ?? 0
                        : result.metricsJson.frameCount ?? "—"}
                    </Text>
                    <Text fontSize="sm" color={theme.text.primary}>
                      {checked ? mse(result.metricsJson.mse) : "—"}
                    </Text>
                    <Text fontSize="sm" color={theme.text.primary}>
                      {checked ? (result.metricsJson.matchesBaseline ? "Matches" : "Changed") : "—"}
                    </Text>
                  </Grid>
                );
              })}
            </Box>
          )}
        </Box>
        {aggregateMse != null ? (
          <Box mt={4}>
              <Text fontSize="md" fontWeight="semibold" mb={2}>Check summary (all formats)</Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap={2}>
              {[
                ["Mean crop MSE", mse(aggregateMse)],
                ["Changed results", primaryResults.filter((result) => result.metricsJson.matchesBaseline === false).length],
              ].map(([label, value]) => (
                <Box key={label} border="1px solid" borderColor={theme.dashboard.border} borderRadius="xl" p={3} bg={theme.background.card}>
                  <Text color={theme.text.muted} fontSize="xs">{label}</Text>
                  <Text color={theme.text.primary} fontSize="lg" fontWeight="semibold">{value}</Text>
                </Box>
              ))}
            </SimpleGrid>
          </Box>
        ) : selectedRun?.status === "completed" ? (
          <Text fontSize="sm" color={theme.text.muted} mt={4}>
            Process run recorded {primaryResults.reduce((sum, result) => sum + (result.metricsJson.frameCount ?? 0), 0)} crop frames.
          </Text>
        ) : null}
      </Box>
    </SimpleGrid>
  );
}
