import { invoke } from "@tauri-apps/api/core";
import { executeBenchmarkRun } from "./benchmark-runner";
import { benchmarkPersistenceService, testDataService } from "../test-data.service";
import type { BenchmarkResult, BenchmarkRun, TestClip, TestDataset, TestKeyframe } from "../types";

export interface BenchmarkCliRequest {
  datasetId: string;
  jsonOutput: boolean;
}

export interface BenchmarkCliAspectSummary {
  aspectId: string;
  status: string;
  focusHitRate: number | null;
  meanFocusErrorRadius: number | null;
  error: string | null;
}

export interface BenchmarkCliClipSummary {
  clipId: string;
  clipName: string;
  status: string;
  aspects: BenchmarkCliAspectSummary[];
  error: string | null;
}

export interface BenchmarkCliSummary {
  datasetId: string;
  datasetName: string;
  runId: string;
  status: string;
  completedClips: number;
  failedClips: number;
  manifestPath: string | null;
  error: string | null;
  clips: BenchmarkCliClipSummary[];
}

export async function loadBenchmarkRunInput(datasetId: string): Promise<{
  dataset: TestDataset;
  clips: TestClip[];
  annotations: Record<string, TestKeyframe[]>;
}> {
  const [dataset, clips] = await Promise.all([
    testDataService.getDataset(datasetId),
    testDataService.listClips(datasetId),
  ]);
  if (!dataset) {
    throw new Error(`Test dataset ${datasetId} was not found.`);
  }
  const entries = await Promise.all(
    clips.map(async (clip) => [clip.id, await testDataService.getAnnotations(clip.id)] as const),
  );
  const annotations = Object.fromEntries(entries) as Record<string, TestKeyframe[]>;
  const ready = clips.filter((clip) => annotations[clip.id]?.length);
  if (!ready.length) {
    throw new Error("No annotated clips found. Add at least one keyframe before running the benchmark.");
  }
  return { dataset, clips: ready, annotations };
}

function summarizeResults(
  dataset: TestDataset,
  run: BenchmarkRun,
  clips: TestClip[],
  results: BenchmarkResult[],
): BenchmarkCliSummary {
  const resultsByClip = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const bucket = resultsByClip.get(result.clipId) ?? [];
    bucket.push(result);
    resultsByClip.set(result.clipId, bucket);
  }

  const clipSummaries: BenchmarkCliClipSummary[] = clips.map((clip) => {
    const clipResults = resultsByClip.get(clip.id) ?? [];
    if (!clipResults.length) {
      return {
        clipId: clip.id,
        clipName: clip.name,
        status: "failed",
        aspects: [],
        error: "No benchmark results were recorded for this clip.",
      };
    }
    const aspects = clipResults.map((result) => ({
      aspectId: result.aspectId,
      status: result.status,
      focusHitRate: result.metricsJson.focusHitRate ?? null,
      meanFocusErrorRadius: result.metricsJson.meanFocusErrorRadius ?? null,
      error: result.error,
    }));
    const failed = clipResults.some((result) => result.status === "failed");
    return {
      clipId: clip.id,
      clipName: clip.name,
      status: failed ? "failed" : "completed",
      aspects,
      error: failed
        ? clipResults.find((result) => result.error)?.error ?? null
        : null,
    };
  });

  const completedClips = clipSummaries.filter((clip) => clip.status === "completed").length;
  const failedClips = clipSummaries.length - completedClips;

  return {
    datasetId: dataset.id,
    datasetName: dataset.name,
    runId: run.id,
    status: run.status,
    completedClips,
    failedClips,
    manifestPath: null,
    error: run.error,
    clips: clipSummaries,
  };
}

export async function runBenchmarkCli(request: BenchmarkCliRequest): Promise<void> {
  const { dataset, clips, annotations } = await loadBenchmarkRunInput(request.datasetId);
  const controller = new AbortController();
  const run = await executeBenchmarkRun({
    datasetId: request.datasetId,
    clips,
    annotations,
    signal: controller.signal,
    onProgress: ({ clipIndex, clipCount, clipName, phase }) => {
      void invoke("log_benchmark_cli_progress", {
        message: `[${clipIndex + 1}/${clipCount}] ${clipName}: ${phase}`,
      }).catch(() => {});
    },
  });
  const results = await benchmarkPersistenceService.listResults(run.id);
  const summary = summarizeResults(dataset, run, clips, results);
  await invoke("finish_benchmark_cli_command", { summary });
}

export async function getBenchmarkCliRequest(): Promise<BenchmarkCliRequest | null> {
  return invoke<BenchmarkCliRequest | null>("get_benchmark_cli_request");
}
