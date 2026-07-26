import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, HStack, Progress, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { save } from "@tauri-apps/plugin-dialog";
import { Archive, BookmarkCheck, FolderOpen, GitCompare, Play, Plus, StopCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { appToast } from "../../../shared/utils/toast.service";
import { useTheme } from "../../../theme";
import { ClipperLayout } from "../../clipper/components/clipper-layout.component";
import { executeBenchmarkRun, type BenchmarkRunnerProgress } from "../benchmark/benchmark-runner.util";
import { CreateTestClipModal } from "../components/create-test-clip-modal.component";
import { BenchmarkRunsPanel } from "../components/benchmark-runs-panel.component";
import { TestClipListRow } from "../components/test-clip-list-row.component";
import { benchmarkPersistenceService, testDataService } from "../test-data.service";
import type { BenchmarkResult, BenchmarkRun, DriftSummary, TestClip, TestDataset } from "../test.types";

function formatMatchPct(value: number | undefined): string {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

export function TestDatasetPage() {
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const createClip = useDisclosure();
  const [dataset, setDataset] = useState<TestDataset | null>(null);
  const [clips, setClips] = useState<TestClip[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<BenchmarkRunnerProgress | null>(null);
  const [lastDriftSummary, setLastDriftSummary] = useState<DriftSummary | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedDataset, loadedClips, loadedRuns] = await Promise.all([
        testDataService.getDataset(datasetId),
        testDataService.listClips(datasetId),
        benchmarkPersistenceService.listRuns(datasetId),
      ]);
      setDataset(loadedDataset);
      setClips(loadedClips);
      setRuns(loadedRuns);
      setSelectedRunId((current) => current ?? loadedRuns[0]?.id ?? null);
    } catch (error) {
      appToast.error("Could not load dataset", String(error));
    } finally {
      setLoading(false);
    }
  }, [datasetId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedRunId) { setResults([]); return; }
    void benchmarkPersistenceService.listResults(selectedRunId).then(setResults).catch(() => setResults([]));
  }, [selectedRunId]);

  const rememberedRun = useMemo(
    () => runs.find((run) => run.id === dataset?.rememberedRunId) ?? null,
    [dataset?.rememberedRunId, runs],
  );

  const runProcessing = async (mode: "process" | "check") => {
    if (abortRef.current || clips.length === 0) return;
    if (mode === "check" && !dataset?.rememberedRunId) {
      appToast.error("No remembered baseline", "Run processing, then Remember a completed run before Check.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const { run, driftSummary } = await executeBenchmarkRun({
        datasetId,
        clips,
        signal: controller.signal,
        mode,
        rememberedRunId: dataset?.rememberedRunId,
        onProgress: setProgress,
      });
      if (run.status === "failed") {
        appToast.error("Run failed", run.error ?? run.status);
      } else if (run.error) {
        appToast.warning("Run finished with errors", run.error);
      } else if (mode === "check" && driftSummary) {
        setLastDriftSummary(driftSummary);
        appToast.success(
          "Check finished",
          `${formatMatchPct(driftSummary.matchPct)} metadata match (${formatMatchPct(driftSummary.driftPct)} drift)`,
        );
      } else {
        appToast.success("Processing finished", run.status);
      }
      setSelectedRunId(run.id);
      await load();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        appToast.info("Run cancelled");
      } else {
        appToast.error("Run failed", String(error));
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const rememberSelectedRun = async () => {
    if (!selectedRunId) {
      appToast.error("No run selected", "Select a completed run to remember.");
      return;
    }
    const selected = runs.find((run) => run.id === selectedRunId);
    if (!selected || selected.status !== "completed") {
      appToast.error("Run not ready", "Only completed runs can be remembered.");
      return;
    }
    try {
      await testDataService.rememberDatasetRun(datasetId, selectedRunId);
      appToast.success("Baseline remembered", new Date(selected.createdAt).toLocaleString());
      await load();
    } catch (error) {
      appToast.error("Could not remember run", String(error));
    }
  };

  const exportDataset = async () => {
    const destination = await save({ defaultPath: `${dataset?.name || "test-dataset"}.ocbench`, filters: [{ name: "Open Clipper benchmark", extensions: ["ocbench"] }] });
    if (!destination) return;
    try {
      await testDataService.exportDataset(datasetId, destination);
      appToast.success("Dataset exported", destination);
    } catch (error) {
      appToast.error("Could not export dataset", String(error));
    }
  };

  if (loading) return <ClipperLayout><AppLoader /></ClipperLayout>;
  if (!dataset) return <ClipperLayout><Text>Test dataset was not found.</Text></ClipperLayout>;

  const isRunning = running;

  return (
    <ClipperLayout backLink={{ label: "Back to test datasets", onClick: () => navigate("/clipper?tab=tests") }}>
      <VStack align="stretch" gap={7}>
        <HStack justify="space-between" align="start" gap={4} flexWrap="wrap">
          <VStack align="start" gap={1}>
            <Text fontSize="3xl" fontWeight="bold">{dataset.name}</Text>
            <Text color={theme.text.muted}>{dataset.description || "Smart Follow metadata regression dataset"}</Text>
            <Text fontSize="sm" color={theme.text.muted}>
              {rememberedRun
                ? `Remembered baseline: ${new Date(rememberedRun.createdAt).toLocaleString()}`
                : "No remembered baseline yet"}
            </Text>
          </VStack>
          <HStack gap={2} flexWrap="wrap">
            <OutlinedActionButton startIcon={<FolderOpen size={16} />} onClick={() => void testDataService.openDatasetDir(datasetId)}>Open folder</OutlinedActionButton>
            <OutlinedActionButton startIcon={<Archive size={16} />} onClick={() => void exportDataset()}>Export</OutlinedActionButton>
            <OutlinedActionButton startIcon={<Plus size={16} />} onClick={createClip.onOpen}>Add clip</OutlinedActionButton>
          </HStack>
        </HStack>

        <Box p={5} border="1px solid" borderColor={theme.dashboard.border} borderRadius="2xl" bg={theme.background.card}>
          <HStack justify="space-between" gap={4} flexWrap="wrap">
            <VStack align="start" gap={1}>
              <Text fontWeight="bold">Metadata regression</Text>
              <Text fontSize="sm" color={theme.text.muted}>
                Run processes clips and stores crop metadata. Remember pins a baseline. Check compares the next run and reports metadata match.
              </Text>
            </VStack>
            {isRunning ? (
              <Button colorPalette="red" onClick={() => abortRef.current?.abort()}><StopCircle /> Cancel</Button>
            ) : (
              <HStack gap={2} flexWrap="wrap">
                <OutlinedActionButton
                  startIcon={<Play size={16} />}
                  disabled={clips.length === 0}
                  onClick={() => void runProcessing("process")}
                >
                  Run
                </OutlinedActionButton>
                <OutlinedActionButton
                  startIcon={<GitCompare size={16} />}
                  disabled={clips.length === 0 || !dataset.rememberedRunId}
                  onClick={() => void runProcessing("check")}
                >
                  Check
                </OutlinedActionButton>
                <OutlinedActionButton
                  startIcon={<BookmarkCheck size={16} />}
                  disabled={!selectedRunId}
                  onClick={() => void rememberSelectedRun()}
                >
                  Remember
                </OutlinedActionButton>
              </HStack>
            )}
          </HStack>
          {progress ? (
            <VStack align="stretch" gap={2} mt={4}>
              <HStack justify="space-between"><Text fontSize="sm">{progress.clipName}: {progress.phase}</Text><Text fontSize="sm">{progress.clipIndex + 1}/{progress.clipCount}</Text></HStack>
              <Progress.Root value={progress.ratio * 100}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root>
            </VStack>
          ) : null}
          {lastDriftSummary ? (
            <HStack gap={4} mt={4} flexWrap="wrap">
              <Text fontSize="sm" color={theme.text.muted}>Latest check:</Text>
              <Text fontSize="sm" fontWeight="semibold">{formatMatchPct(lastDriftSummary.matchPct)} match</Text>
              <Text fontSize="sm" color={theme.text.muted}>{formatMatchPct(lastDriftSummary.driftPct)} drift</Text>
            </HStack>
          ) : null}
        </Box>

        <VStack align="stretch" gap={3}>
          <Text fontSize="xl" fontWeight="bold">Clips</Text>
          {clips.length === 0 ? <Text color={theme.text.muted}>No clips yet. Add a source and trim a test segment (min 3 seconds).</Text> : clips.map((clip) => (
            <TestClipListRow
              key={clip.id}
              clip={clip}
              onOpen={() => navigate(`/clipper/tests/${datasetId}/clips/${clip.id}`)}
              onDelete={async () => {
                if (!window.confirm(`Delete test clip “${clip.name}”?`)) return;
                await testDataService.deleteClip(clip.id);
                await load();
              }}
            />
          ))}
        </VStack>

        <BenchmarkRunsPanel
          runs={runs}
          selectedRunId={selectedRunId}
          rememberedRunId={dataset.rememberedRunId ?? null}
          onSelectRun={setSelectedRunId}
          results={results}
          clips={clips}
        />
      </VStack>

      <CreateTestClipModal
        open={createClip.open}
        datasetId={datasetId}
        onClose={createClip.onClose}
        onCreated={() => {
          void load();
        }}
      />
    </ClipperLayout>
  );
}
