import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, HStack, Progress, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { save } from "@tauri-apps/plugin-dialog";
import { Archive, FolderOpen, Play, Plus, StopCircle, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLoader } from "../../../shared/components/AppLoader";
import { OutlinedActionButton } from "../../../shared/components/buttons/OutlinedActionButton";
import { appToast } from "../../../shared/utils/toast.service";
import { useTheme } from "../../../theme";
import { ClipperLayout } from "../../clipper/components/ClipperLayout";
import { executeBenchmarkRun, type BenchmarkRunnerProgress } from "../benchmark/benchmark-runner";
import { CreateTestClipModal } from "../components/CreateTestClipModal";
import { BenchmarkRunsPanel } from "../components/BenchmarkRunsPanel";
import { TestClipListRow } from "../components/TestClipListRow";
import { benchmarkPersistenceService, testDataService } from "../test-data.service";
import type { BenchmarkResult, BenchmarkRun, TestClip, TestDataset, TestKeyframe } from "../types";

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

  const annotationCounts = useMemo(() => new Map(clips.map((clip) => [clip.id, clip.annotationRevision])), [clips]);

  const runBenchmark = async () => {
    if (abortRef.current) return;
    const entries = await Promise.all(clips.map(async (clip) => [clip.id, await testDataService.getAnnotations(clip.id)] as const));
    const annotations = Object.fromEntries(entries) as Record<string, TestKeyframe[]>;
    const ready = clips.filter((clip) => annotations[clip.id]?.length);
    if (!ready.length) {
      appToast.error("No annotated clips", "Add at least one keyframe before running the benchmark.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const run = await executeBenchmarkRun({
        datasetId,
        clips: ready,
        annotations,
        signal: controller.signal,
        onProgress: setProgress,
      });
      appToast.success("Benchmark finished", run.status);
      setSelectedRunId(run.id);
      await load();
    } finally {
      abortRef.current = null;
      setProgress(null);
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

  return (
    <ClipperLayout backLink={{ label: "Back to test datasets", onClick: () => navigate("/clipper?tab=tests") }}>
      <VStack align="stretch" gap={7}>
        <HStack justify="space-between" align="start" gap={4} flexWrap="wrap">
          <VStack align="start" gap={1}>
            <Text fontSize="3xl" fontWeight="bold">{dataset.name}</Text>
            <Text color={theme.text.muted}>{dataset.description || "Manual framing reference dataset"}</Text>
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
              <Text fontWeight="bold">Production tracking benchmark</Text>
              <Text fontSize="sm" color={theme.text.muted}>Runs Smart Follow for 9:16, 1:1, 4:5 and 16:9 using immutable annotation snapshots.</Text>
            </VStack>
            {abortRef.current ? (
              <Button colorPalette="red" onClick={() => abortRef.current?.abort()}><StopCircle /> Cancel</Button>
            ) : (
              <OutlinedActionButton startIcon={<Play size={16} />} onClick={() => void runBenchmark()}>Run annotated clips</OutlinedActionButton>
            )}
          </HStack>
          {progress ? (
            <VStack align="stretch" gap={2} mt={4}>
              <HStack justify="space-between"><Text fontSize="sm">{progress.clipName}: {progress.phase}</Text><Text fontSize="sm">{progress.clipIndex + 1}/{progress.clipCount}</Text></HStack>
              <Progress.Root value={progress.ratio * 100}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root>
            </VStack>
          ) : null}
        </Box>

        <VStack align="stretch" gap={3}>
          <Text fontSize="xl" fontWeight="bold">Clips</Text>
          {clips.length === 0 ? <Text color={theme.text.muted}>No clips yet. Add a source and trim a test segment (min 3 seconds).</Text> : clips.map((clip) => (
            <TestClipListRow
              key={clip.id}
              clip={clip}
              isAnnotated={Boolean(annotationCounts.get(clip.id))}
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
          onSelectRun={setSelectedRunId}
          results={results}
          clips={clips}
        />

        <Box pt={5} borderTop="1px solid" borderColor={theme.dashboard.border}>
          <OutlinedActionButton tone="danger" startIcon={<Trash2 size={16} />} onClick={async () => {
            if (!window.confirm(`Delete dataset “${dataset.name}” and all stored videos and runs?`)) return;
            await testDataService.deleteDataset(dataset.id);
            navigate("/clipper?tab=tests");
          }}>Delete dataset</OutlinedActionButton>
        </Box>
      </VStack>

      <CreateTestClipModal
        open={createClip.open}
        datasetId={datasetId}
        onClose={createClip.onClose}
        onCreated={(clip) => {
          void load();
          navigate(`/clipper/tests/${datasetId}/clips/${clip.id}`);
        }}
      />
    </ClipperLayout>
  );
}
