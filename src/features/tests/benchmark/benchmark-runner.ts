import { DEFAULT_CLIPPER_SETTINGS } from "../../clipper/settings/settings";
import { benchmarkPersistenceService, testDataService } from "../test-data.service";
import type { BenchmarkRun, TestClip, TestKeyframe } from "../types";
import { TEST_ASPECTS } from "../types";
import { runTestBenchmarkAnalysis } from "./run-analysis";

export interface BenchmarkRunnerProgress {
  clipIndex: number;
  clipCount: number;
  clipName: string;
  phase: string;
  ratio: number;
}

export async function executeBenchmarkRun(input: {
  datasetId: string;
  clips: TestClip[];
  annotations: Record<string, TestKeyframe[]>;
  signal: AbortSignal;
  onProgress?: (progress: BenchmarkRunnerProgress) => void;
}): Promise<BenchmarkRun> {
  const config = {
    schemaVersion: 1,
    analyzer: "production-smart-follow",
    settings: DEFAULT_CLIPPER_SETTINGS.reframe,
    aspects: TEST_ASPECTS.map(({ id, formatId, ratio }) => ({ id, formatId, ratio })),
    sampling: "decoded-frame-presentation-timestamps",
    createdAt: new Date().toISOString(),
    annotationSnapshots: Object.fromEntries(input.clips.map((clip) => [clip.id, {
      clipSha256: clip.sha256,
      annotationRevision: clip.annotationRevision,
      keyframes: input.annotations[clip.id] ?? [],
    }])),
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
  try {
    for (const [clipIndex, clip] of input.clips.entries()) {
      if (input.signal.aborted) throw new DOMException("Benchmark cancelled", "AbortError");
      const keyframes = input.annotations[clip.id] ?? [];
      const { path } = await testDataService.playableClip(clip.id);
      try {
        const output = await runTestBenchmarkAnalysis({
          clip,
          clipPath: path,
          keyframes,
          signal: input.signal,
          onProgress: ({ phase, ratio }) => input.onProgress?.({
            clipIndex,
            clipCount: input.clips.length,
            clipName: clip.name,
            phase,
            ratio,
          }),
        });
        const clipManifest = {
          clipId: clip.id,
          sha256: clip.sha256,
          annotationRevision: clip.annotationRevision,
          engine: output.engine,
          modelVersion: output.modelVersion,
          trackerVersion: output.trackerVersion,
          sourceFrameRate: output.sourceFrameRate,
          processingMs: output.processingMs,
          degradedReason: output.degradedReason,
        };
        (manifest.clips as unknown[]).push(clipManifest);
        for (const aspect of output.aspects) {
          const relativePath = `clips/${clip.id}/${aspect.aspectId}.jsonl`;
          const detailsPath = await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            relativePath,
            aspect.details.map((detail) => JSON.stringify(detail)).join("\n") + "\n",
          );
          await benchmarkPersistenceService.putResult({
            runId: run.id,
            clipId: clip.id,
            aspectId: aspect.aspectId,
            status: "completed",
            metrics: aspect.metrics as unknown as Record<string, unknown>,
            detailsRelativePath: detailsPath,
          });
        }
        completedClips += 1;
      } catch (error) {
        if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
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
    const manifestPath = await benchmarkPersistenceService.writeArtifact(
      input.datasetId,
      run.id,
      "manifest.json",
      JSON.stringify({ ...manifest, completedClips, failedClips }, null, 2),
    );
    return benchmarkPersistenceService.finishRun(
      run.id,
      completedClips > 0 ? "completed" : "failed",
      failedClips > 0 ? `${failedClips} clip(s) failed.` : undefined,
      manifestPath,
    );
  } catch (error) {
    const cancelled = input.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    return benchmarkPersistenceService.finishRun(
      run.id,
      cancelled ? "cancelled" : "failed",
      cancelled ? "Cancelled by user." : error instanceof Error ? error.message : String(error),
    );
  }
}
