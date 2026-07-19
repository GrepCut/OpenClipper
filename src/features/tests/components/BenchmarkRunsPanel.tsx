import { useMemo, useState } from "react";
import { Box, Grid, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { ImageDown } from "lucide-react";
import { OutlinedActionButton, getOutlinedActionSurfaceProps } from "../../../shared/components/buttons/OutlinedActionButton";
import { appToast } from "../../../shared/utils/toast.service";
import { isTauri } from "../../../shared/utils/platform";
import { colors, useTheme, type Theme } from "../../../theme";
import { computeBenchmarkColumnStats } from "../benchmark/column-stats";
import type { ColumnStatSummary } from "../benchmark/column-stats";
import { benchmarkPersistenceService } from "../test-data.service";
import type { BenchmarkResult, BenchmarkRun, BenchmarkRunStatus, TestClip } from "../types";

function percentage(value: number | undefined): string {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

function formatP5(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

function formatStatRow(
  label: keyof ColumnStatSummary,
  stats: ReturnType<typeof computeBenchmarkColumnStats>,
  asPercent: (value: number | null) => string,
): [string, string, string, string] {
  return [
    label === "avg" ? "Average" : label === "median" ? "Median" : label === "max" ? "Max" : "Min",
    asPercent(stats.coverage[label]),
    asPercent(stats.coverageHit[label]),
    formatP5(stats.p5Coverage[label]),
  ];
}

const SUMMARY_COLUMNS = "minmax(100px, 1.2fr) repeat(3, minmax(72px, 1fr))";

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
  onSelectRun: (runId: string) => void;
  results: BenchmarkResult[];
  clips: TestClip[];
}

const RESULT_COLUMNS = "minmax(120px, 2fr) repeat(4, minmax(72px, 1fr))";

export function BenchmarkRunsPanel({
  runs,
  selectedRunId,
  onSelectRun,
  results,
  clips,
}: BenchmarkRunsPanelProps) {
  const { theme, mode } = useTheme();
  const [exportingRun, setExportingRun] = useState(false);
  const tauri = isTauri();

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const columnStats = useMemo(() => computeBenchmarkColumnStats(results), [results]);
  const summaryRows = useMemo(
    () => (["avg", "median", "max", "min"] as const).map((key) => formatStatRow(key, columnStats, (value) => percentage(value ?? undefined))),
    [columnStats],
  );
  const exportableResultCount = results.filter(
    (result) => result.status === "completed" && Boolean(result.detailsRelativePath),
  ).length;
  const canExport = tauri
    && selectedRun?.status === "completed"
    && exportableResultCount > 0;

  const exportRunMissFrames = async () => {
    if (!selectedRunId || !canExport) return;
    setExportingRun(true);
    try {
      const output = await benchmarkPersistenceService.exportRunMissFrames(selectedRunId);
      appToast.success(
        "Worst keyframes exported",
        `Exported ${output.frameCount} frame(s) from ${output.resultCount} clip/aspect result(s).`,
      );
      if (tauri) {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(output.exportDir);
      }
    } catch (error) {
      appToast.error("Could not export frames", String(error));
    } finally {
      setExportingRun(false);
    }
  };

  return (
    <SimpleGrid columns={{ base: 1, xl: 2 }} gap={5}>
      <Box>
        <Text fontSize="xl" fontWeight="bold" mb={3}>Run history</Text>
        <VStack align="stretch" gap={2}>
          {runs.length === 0 ? (
            <Text color={theme.text.muted}>No benchmark runs.</Text>
          ) : runs.map((run) => {
            const isSelected = selectedRunId === run.id;
            const pill = runStatusPill(run.status, theme, mode);
            return (
              <Box
                key={run.id}
                as="button"
                type="button"
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
              </Box>
            );
          })}
        </VStack>
      </Box>

      <Box>
        <HStack justify="space-between" align="center" gap={3} mb={3}>
          <Text fontSize="xl" fontWeight="bold">Selected run results</Text>
          {tauri ? (
            <OutlinedActionButton
              flexShrink={0}
              startIcon={<ImageDown size={16} />}
              disabled={!canExport || exportingRun}
              onClick={() => void exportRunMissFrames()}
            >
              {exportingRun ? "Exporting…" : "Export worst keyframes"}
            </OutlinedActionButton>
          ) : null}
        </HStack>
        <Box
          border="1px solid"
          borderColor={theme.dashboard.border}
          borderRadius="2xl"
          bg={theme.background.card}
          overflowX="auto"
        >
          {results.length === 0 ? (
            <Text color={theme.text.muted} fontSize="sm" p={5}>
              {selectedRunId ? "No results for this run." : "Select a run to view results."}
            </Text>
          ) : (
            <Box minW="640px">
              <Grid
                templateColumns={RESULT_COLUMNS}
                gap={3}
                px={4}
                py={3}
                bg={theme.background.tertiary}
                borderTopRadius="2xl"
              >
                {["Clip", "Aspect", "Coverage", "Coverage hit", "P5 coverage"].map((label) => (
                  <Text key={label} color={theme.text.muted} fontSize="xs" fontWeight="semibold">
                    {label}
                  </Text>
                ))}
              </Grid>
              {results.map((result, index) => {
                const clip = clips.find((candidate) => candidate.id === result.clipId);
                const isLast = index === results.length - 1;
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
                    <Text fontSize="sm" color={theme.text.primary}>{clip?.name ?? result.clipId}</Text>
                    <Text fontSize="sm" color={theme.text.primary}>{result.aspectId}</Text>
                    <Text fontSize="sm" color={theme.text.primary}>{percentage(result.metricsJson.meanCoverageFraction)}</Text>
                    <Text fontSize="sm" color={theme.text.primary}>{percentage(result.metricsJson.coverageHitRate)}</Text>
                    <Text fontSize="sm" color={theme.text.primary}>{formatP5(result.metricsJson.p5CoverageFraction ?? undefined)}</Text>
                  </Grid>
                );
              })}
            </Box>
          )}
        </Box>
        {results.length > 0 ? (
          <Box mt={4}>
            <Text fontSize="md" fontWeight="semibold" mb={2}>Primary 9:16 result</Text>
            <SimpleGrid columns={{ base: 1, sm: 3 }} gap={2} mb={4}>
              {[
                ["Coverage", percentage(columnStats.portrait9x16.coverage.avg ?? undefined)],
                ["Coverage hit", percentage(columnStats.portrait9x16.coverageHit.avg ?? undefined)],
                ["Both boxes covered", percentage(columnStats.portrait9x16.dualAllCovered.avg ?? undefined)],
              ].map(([label, value]) => (
                <Box key={label} border="1px solid" borderColor={theme.dashboard.border} borderRadius="xl" p={3} bg={theme.background.card}>
                  <Text color={theme.text.muted} fontSize="xs">{label}</Text>
                  <Text color={theme.text.primary} fontSize="lg" fontWeight="semibold">{value}</Text>
                </Box>
              ))}
            </SimpleGrid>
            <Text fontSize="md" fontWeight="semibold" mb={2}>Column summary</Text>
            <Box
              border="1px solid"
              borderColor={theme.dashboard.border}
              borderRadius="2xl"
              bg={theme.background.card}
              overflowX="auto"
            >
              <Box minW="480px">
                <Grid
                  templateColumns={SUMMARY_COLUMNS}
                  gap={3}
                  px={4}
                  py={3}
                  bg={theme.background.tertiary}
                  borderTopRadius="2xl"
                >
                  {["", "Coverage", "Coverage hit", "P5 coverage"].map((label) => (
                    <Text key={label || "stat"} color={theme.text.muted} fontSize="xs" fontWeight="semibold">
                      {label}
                    </Text>
                  ))}
                </Grid>
                {summaryRows.map(([label, coverage, coverageHit, p5], index) => {
                  const isLast = index === summaryRows.length - 1;
                  return (
                    <Grid
                      key={label}
                      templateColumns={SUMMARY_COLUMNS}
                      gap={3}
                      px={4}
                      py={3}
                      alignItems="center"
                      bg={theme.background.card}
                      borderBottom={isLast ? "none" : "1px solid"}
                      borderColor={theme.dashboard.border}
                      borderBottomRadius={isLast ? "2xl" : undefined}
                    >
                      <Text fontSize="sm" color={theme.text.muted} fontWeight="medium">{label}</Text>
                      <Text fontSize="sm" color={theme.text.primary}>{coverage}</Text>
                      <Text fontSize="sm" color={theme.text.primary}>{coverageHit}</Text>
                      <Text fontSize="sm" color={theme.text.primary}>{p5}</Text>
                    </Grid>
                  );
                })}
              </Box>
            </Box>
          </Box>
        ) : null}
      </Box>
    </SimpleGrid>
  );
}
