import { invoke } from "@tauri-apps/api/core";
import { pathBackedFile } from "../clipper/platform/native-source";
import { resolveFilePlayableUrl } from "../clipper/persistence/tauri-media";
import type {
  BenchmarkResult,
  BenchmarkRun,
  TestClip,
  TestDataset,
  TestDatasetSummary,
  TestKeyframe,
} from "./types";

export const testDataService = {
  listDatasets: () => invoke<TestDatasetSummary[]>("test_dataset_list"),
  getDataset: (id: string) => invoke<TestDataset | null>("test_dataset_get", { id }),
  createDataset: (name: string, description?: string) =>
    invoke<TestDataset>("test_dataset_create", {
      id: crypto.randomUUID(),
      name,
      description: description || null,
    }),
  updateDataset: (id: string, name: string, description?: string) =>
    invoke<TestDataset>("test_dataset_update", { id, name, description: description || null }),
  deleteDataset: (id: string) => invoke<void>("test_dataset_delete", { id }),
  listClips: (datasetId: string) => invoke<TestClip[]>("test_clip_list", { datasetId }),
  getClip: (id: string) => invoke<TestClip | null>("test_clip_get", { id }),
  createClip: (input: {
    datasetId: string;
    name: string;
    sourcePath: string;
    originalFileName: string;
    startTime: number;
    endTime: number;
  }) => invoke<TestClip>("test_clip_create", { input: { id: crypto.randomUUID(), ...input } }),
  deleteClip: (id: string) => invoke<void>("test_clip_delete", { id }),
  getAnnotations: (clipId: string) =>
    invoke<TestKeyframe[]>("test_clip_annotations_get", { clipId }),
  replaceAnnotations: (clipId: string, keyframes: TestKeyframe[]) =>
    invoke<{ annotationRevision: number; keyframes: TestKeyframe[] }>(
      "test_clip_annotations_replace",
      { clipId, keyframes },
    ),
  playableClip: async (id: string): Promise<{ path: string; url: string }> => {
    const path = await invoke<string>("test_clip_file_path", { id });
    return { path, url: await resolveFilePlayableUrl(pathBackedFile(path, "test-clip.mp4")) };
  },
  openDatasetDir: (datasetId: string) => invoke<string>("open_test_dataset_dir", { datasetId }),
  exportDataset: (datasetId: string, destinationPath: string) =>
    invoke<string>("test_dataset_export", { datasetId, destinationPath }),
  importDataset: (sourcePath: string) =>
    invoke<TestDataset>("test_dataset_import", { sourcePath }),
};

export const benchmarkPersistenceService = {
  createRun: (
    datasetId: string,
    clipIds: string[],
    config: Record<string, unknown>,
  ) => invoke<BenchmarkRun>("benchmark_run_create", {
    id: crypto.randomUUID(),
    datasetId,
    clipIds,
    config,
  }),
  finishRun: (
    id: string,
    status: BenchmarkRun["status"],
    error?: string,
    manifestRelativePath?: string,
  ) => invoke<BenchmarkRun>("benchmark_run_finish", {
    id,
    status,
    error: error || null,
    manifestRelativePath: manifestRelativePath || null,
  }),
  listRuns: (datasetId: string) => invoke<BenchmarkRun[]>("benchmark_run_list", { datasetId }),
  putResult: (input: {
    runId: string;
    clipId: string;
    aspectId: string;
    status: "completed" | "failed";
    metrics: Record<string, unknown>;
    detailsRelativePath?: string;
    error?: string;
  }) => invoke<BenchmarkResult>("benchmark_result_put", {
    input: {
      id: crypto.randomUUID(),
      ...input,
      detailsRelativePath: input.detailsRelativePath || null,
      error: input.error || null,
    },
  }),
  listResults: (runId: string) => invoke<BenchmarkResult[]>("benchmark_result_list", { runId }),
  writeArtifact: (
    datasetId: string,
    runId: string,
    relativePath: string,
    contents: string,
  ) => invoke<string>("write_test_run_artifact", {
    datasetId,
    runId,
    relativePath,
    contents,
  }),
  exportMissFrames: (resultId: string) =>
    invoke<{ exportDir: string; frameCount: number; manifestRelativePath: string }>(
      "export_benchmark_miss_frames",
      { resultId },
    ),
};
