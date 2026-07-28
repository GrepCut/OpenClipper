import { invoke } from "@tauri-apps/api/core";
import { executeBenchmarkRun } from "./benchmark-runner.util";
import {
  benchmarkPersistenceService,
  testDataService,
} from "../test-data.service";
import type {
  BenchmarkResult,
  BenchmarkRun,
  DriftSummary,
  TestClip,
  TestDataset,
} from "../test.types";
import type { VisionAblationConfig } from "../../clipper/engine/reframe";

export interface BenchmarkCliRequest {
  datasetId: string;
  jsonOutput: boolean;
  check: boolean;
  remember: boolean;
  visionAblation: VisionAblationConfig;
}

export interface BenchmarkCliClipSummary {
  clipId: string;
  clipName: string;
  status: string;
  matchesBaseline: boolean | null;
  mse: number | null;
  frameCount: number | null;
  processingMs: number | null;
  realtimeFactor: number | null;
  speedup: number | null;
  error: string | null;
}

export interface BenchmarkCliSummary {
  datasetId: string;
  datasetName: string;
  datasetRole?: "tuning" | "holdout";
  runId: string;
  status: string;
  mode: "process" | "check";
  completedClips: number;
  failedClips: number;
  manifestPath: string | null;
  driftSummary: DriftSummary | null;
  error: string | null;
  clips: BenchmarkCliClipSummary[];
}

const PRIMARY_ASPECT_ID = "9-16";

export async function loadBenchmarkRunInput(datasetId: string): Promise<{
  dataset: TestDataset;
  clips: TestClip[];
}> {
  const [dataset, clips] = await Promise.all([
    testDataService.getDataset(datasetId),
    testDataService.listClips(datasetId),
  ]);
  if (!dataset) {
    throw new Error(`Test dataset ${datasetId} was not found.`);
  }
  if (!clips.length) {
    throw new Error("No clips found. Add at least one clip before running.");
  }
  return { dataset, clips };
}

function summarizeResults(
  dataset: TestDataset,
  run: BenchmarkRun,
  clips: TestClip[],
  results: BenchmarkResult[],
  mode: "process" | "check",
  driftSummary: DriftSummary | null,
): BenchmarkCliSummary {
  const resultsByClip = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const bucket = resultsByClip.get(result.clipId) ?? [];
    bucket.push(result);
    resultsByClip.set(result.clipId, bucket);
  }

  const clipSummaries: BenchmarkCliClipSummary[] = clips.map((clip) => {
    const clipResults = resultsByClip.get(clip.id) ?? [];
    const primary = clipResults.find(
      (result) => result.aspectId === PRIMARY_ASPECT_ID,
    );
    if (!primary) {
      return {
        clipId: clip.id,
        clipName: clip.name,
        status: "failed",
        matchesBaseline: null,
        mse: null,
        frameCount: null,
        processingMs: null,
        realtimeFactor: null,
        speedup: null,
        error: "No metadata results were recorded for this clip.",
      };
    }
    const failed = primary.status === "failed";
    return {
      clipId: clip.id,
      clipName: clip.name,
      status: failed ? "failed" : "completed",
      matchesBaseline: primary.metricsJson.matchesBaseline ?? null,
      mse: primary.metricsJson.mse ?? null,
      frameCount:
        primary.metricsJson.frameCount ??
        primary.metricsJson.comparedFrames ??
        null,
      processingMs: primary.metricsJson.processingMs ?? null,
      realtimeFactor: primary.metricsJson.realtimeFactor ?? null,
      speedup: primary.metricsJson.speedup ?? null,
      error: failed ? primary.error : null,
    };
  });

  const completedClips = clipSummaries.filter(
    (clip) => clip.status === "completed",
  ).length;
  const failedClips = clipSummaries.length - completedClips;

  return {
    datasetId: dataset.id,
    datasetName: dataset.name,
    datasetRole: dataset.datasetRole,
    runId: run.id,
    status: run.status,
    mode,
    completedClips,
    failedClips,
    manifestPath: null,
    driftSummary,
    error: run.error,
    clips: clipSummaries,
  };
}

export async function runBenchmarkCli(
  request: BenchmarkCliRequest,
): Promise<void> {
  const { dataset, clips } = await loadBenchmarkRunInput(request.datasetId);
  if (request.check && !dataset.rememberedRunId) {
    throw new Error(
      "No remembered baseline. Run processing, then Remember a completed run before Check.",
    );
  }
  const mode = request.check ? "check" : "process";
  const controller = new AbortController();
  const { run, driftSummary } = await executeBenchmarkRun({
    datasetId: request.datasetId,
    clips,
    signal: controller.signal,
    mode,
    rememberedRunId: dataset.rememberedRunId,
    visionAblation: request.visionAblation,
    onProgress: ({ clipIndex, clipCount, clipName, phase }) => {
      void invoke("log_benchmark_cli_progress", {
        message: `[${clipIndex + 1}/${clipCount}] ${clipName}: ${phase}`,
      }).catch(() => {});
    },
  });
  if (request.remember && run.status === "completed") {
    await testDataService.rememberDatasetRun(request.datasetId, run.id);
  }
  const results = await benchmarkPersistenceService.listResults(run.id);
  const summary = summarizeResults(
    dataset,
    run,
    clips,
    results,
    mode,
    driftSummary,
  );
  await invoke("finish_benchmark_cli_command", { summary });
}

export async function getBenchmarkCliRequest(): Promise<BenchmarkCliRequest | null> {
  return invoke<BenchmarkCliRequest | null>("get_benchmark_cli_request");
}
