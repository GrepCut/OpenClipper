import {
  benchmarkPersistenceService,
  testDataService,
} from "../test-data.service";
import type { BenchmarkRun, DriftSummary, TestClip } from "../test.types";
import { TEST_ASPECTS } from "../test.types";
import {
  buildDriftSummary,
  compareFrameMetadata,
  parseFrameMetaJsonl,
} from "./metadata-drift.util";
import { resolveClipCohorts } from "./cohort-tags.util";
import { runTestBenchmarkAnalysis } from "./run-analysis.util";
import type { VisionAblationConfig } from "../../clipper/engine/reframe";

export interface BenchmarkRunnerProgress {
  clipIndex: number;
  clipCount: number;
  clipName: string;
  phase: string;
  ratio: number;
}

export type BenchmarkRunMode = "process" | "check";

function frameMetaJsonl(
  frames: Array<{ timestampUs: number; layoutMode: string; panels: unknown[] }>,
): string {
  return frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n";
}

async function loadBaselineFrames(
  datasetId: string,
  baselineRunId: string,
  clipId: string,
  aspectId: string,
): Promise<ReturnType<typeof parseFrameMetaJsonl>> {
  const relativePath = `runs/${baselineRunId}/clips/${clipId}/${aspectId}.crop.jsonl`;
  let contents: string;
  try {
    contents = await benchmarkPersistenceService.readArtifact(
      datasetId,
      relativePath,
    );
  } catch {
    throw new Error(
      "Remembered baseline uses the legacy metadata format. Run processing and Remember a new baseline.",
    );
  }
  return parseFrameMetaJsonl(contents);
}

async function loadBaselineProcessingMs(
  datasetId: string,
  baselineRunId: string,
  clipId: string,
): Promise<number | null> {
  const contents = await benchmarkPersistenceService.readArtifact(
    datasetId,
    `runs/${baselineRunId}/manifest.json`,
  );
  const manifest = JSON.parse(contents) as {
    clips?: Array<{ clipId?: string; processingMs?: unknown }>;
  };
  const value = manifest.clips?.find(
    (entry) => entry.clipId === clipId,
  )?.processingMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export async function executeBenchmarkRun(input: {
  datasetId: string;
  clips: TestClip[];
  signal: AbortSignal;
  mode?: BenchmarkRunMode;
  rememberedRunId?: string | null;
  visionAblation?: VisionAblationConfig;
  onProgress?: (progress: BenchmarkRunnerProgress) => void;
}): Promise<{ run: BenchmarkRun; driftSummary: DriftSummary | null }> {
  const mode = input.mode ?? "process";
  const baselineRunId =
    mode === "check" ? (input.rememberedRunId ?? null) : null;
  if (mode === "check" && !baselineRunId) {
    throw new Error(
      "No remembered baseline. Run processing, then Remember a completed run before Check.",
    );
  }

  const config = {
    schemaVersion: 4,
    cropSnapshotSchema: "crop-geometry-v1",
    mode,
    analyzer: "production-smart-follow",
    baselineRunId,
    aspects: TEST_ASPECTS.map(({ id, formatId, ratio }) => ({
      id,
      formatId,
      ratio,
    })),
    sampling: "decoded-frame-presentation-timestamps",
    createdAt: new Date().toISOString(),
    visionAblation: input.visionAblation ?? {},
  };
  const run = await benchmarkPersistenceService.createRun(
    input.datasetId,
    input.clips.map((clip) => clip.id),
    config,
  );
  const manifest: Record<string, unknown> = {
    runId: run.id,
    datasetId: input.datasetId,
    config,
    clips: [],
  };
  let completedClips = 0;
  let failedClips = 0;
  const perClipDrift: DriftSummary["perClip"] = [];

  try {
    for (const [clipIndex, clip] of input.clips.entries()) {
      if (input.signal.aborted)
        throw new DOMException("Benchmark cancelled", "AbortError");
      const { path } = await testDataService.playableClip(clip.id);
      try {
        const output = await runTestBenchmarkAnalysis({
          clip,
          clipPath: path,
          signal: input.signal,
          visionAblation: input.visionAblation,
          onProgress: ({ phase, ratio }) =>
            input.onProgress?.({
              clipIndex,
              clipCount: input.clips.length,
              clipName: clip.name,
              phase,
              ratio,
            }),
        });
        const clipManifest = {
          clipId: clip.id,
          clipName: clip.name,
          cohorts: resolveClipCohorts(clip),
          sha256: clip.sha256,
          engine: output.engine,
          modelVersion: output.modelVersion,
          trackerVersion: output.trackerVersion,
          sourceFrameRate: output.sourceFrameRate,
          processingMs: output.processingMs,
          degradedReason: output.degradedReason,
          nativeMetrics: output.nativeMetrics,
        };
        (manifest.clips as unknown[]).push(clipManifest);
        if (output.autoflipDebug != null) {
          await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            `clips/${clip.id}/autoflip-debug.json`,
            JSON.stringify(output.autoflipDebug),
          );
        }
        if (output.nativeMetrics != null) {
          await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            `clips/${clip.id}/native-metrics.json`,
            JSON.stringify(output.nativeMetrics, null, 2),
          );
        }
        const baselineProcessingMs =
          mode === "check" && baselineRunId
            ? await loadBaselineProcessingMs(
                input.datasetId,
                baselineRunId,
                clip.id,
              )
            : null;
        for (const aspect of output.aspects) {
          const relativePath = `clips/${clip.id}/${aspect.aspectId}.crop.jsonl`;
          const detailsPath = await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            relativePath,
            frameMetaJsonl(aspect.frames),
          );
          let resultMetrics: Record<string, unknown> = {
            frameCount: aspect.frames.length,
            processingMs: output.processingMs,
            realtimeFactor:
              output.processingMs > 0
                ? (clip.duration * 1000) / output.processingMs
                : null,
          };
          if (mode === "check" && baselineRunId) {
            const baselineFrames = await loadBaselineFrames(
              input.datasetId,
              baselineRunId,
              clip.id,
              aspect.aspectId,
            );
            const comparison = compareFrameMetadata(
              baselineFrames,
              aspect.frames,
            );
            resultMetrics = {
              matchesBaseline: comparison.matchesBaseline,
              mse: comparison.mse,
              maxFrameMse: comparison.maxFrameMse,
              changedFrameCount: comparison.changedFrameCount,
              structuralMismatchCount: comparison.structuralMismatchCount,
              comparedFrames: comparison.comparedFrames,
              processingMs: output.processingMs,
              realtimeFactor:
                output.processingMs > 0
                  ? (clip.duration * 1000) / output.processingMs
                  : null,
              speedup:
                baselineProcessingMs != null && output.processingMs > 0
                  ? baselineProcessingMs / output.processingMs
                  : null,
            };
            perClipDrift.push({
              clipId: clip.id,
              aspectId: aspect.aspectId,
              ...comparison,
            });
          }
          await benchmarkPersistenceService.putResult({
            runId: run.id,
            clipId: clip.id,
            aspectId: aspect.aspectId,
            status: "completed",
            metrics: resultMetrics,
            detailsRelativePath: detailsPath,
          });
        }
        completedClips += 1;
      } catch (error) {
        if (
          input.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          throw error;
        failedClips += 1;
        const message = error instanceof Error ? error.message : String(error);
        (manifest.clips as unknown[]).push({ clipId: clip.id, error: message });
        for (const aspect of TEST_ASPECTS) {
          await benchmarkPersistenceService.putResult({
            runId: run.id,
            clipId: clip.id,
            aspectId: aspect.id,
            status: "failed",
            metrics: {},
            error: message,
          });
        }
      }
    }

    const driftSummary =
      mode === "check" && baselineRunId
        ? buildDriftSummary({ baselineRunId, perClip: perClipDrift })
        : null;

    const manifestPath = await benchmarkPersistenceService.writeArtifact(
      input.datasetId,
      run.id,
      "manifest.json",
      JSON.stringify(
        {
          ...manifest,
          completedClips,
          failedClips,
          driftSummary,
        },
        null,
        2,
      ),
    );
    const finishedRun = await benchmarkPersistenceService.finishRun(
      run.id,
      completedClips > 0 ? "completed" : "failed",
      failedClips > 0 ? `${failedClips} clip(s) failed.` : undefined,
      manifestPath,
    );
    return { run: finishedRun, driftSummary };
  } catch (error) {
    const cancelled =
      input.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");
    const finishedRun = await benchmarkPersistenceService.finishRun(
      run.id,
      cancelled ? "cancelled" : "failed",
      cancelled
        ? "Cancelled by user."
        : error instanceof Error
          ? error.message
          : String(error),
    );
    return { run: finishedRun, driftSummary: null };
  }
}
