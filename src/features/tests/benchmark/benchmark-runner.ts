import { DEFAULT_CLIPPER_SETTINGS } from "../../clipper/settings/settings";
import { benchmarkPersistenceService, testDataService } from "../test-data.service";
import type { BenchmarkRun, TestClip, TestKeyframe } from "../types";
import { TEST_ASPECTS } from "../types";
import { computeBenchmarkColumnStats } from "./column-stats";
import { computeCohortStats } from "./cohort-stats";
import { resolveClipCohorts } from "./cohort-tags";
import { runTestBenchmarkAnalysis } from "./run-analysis";

export interface BenchmarkRunnerProgress {
  clipIndex: number;
  clipCount: number;
  clipName: string;
  phase: string;
  ratio: number;
}

const PORTRAIT_ACCEPTANCE_GATES = {
  minCoverageHitRate: 0.85,
  minMeanCoverageFraction: 0.80,
  minDualTargetAllCoveredRate: 0.75,
  /** Three times the run3 mean on the reference machine. */
  maxMeanProcessingMs: 12_350,
};

const RUN4_PORTRAIT_FLOOR = {
  minCoverageHitRate: 0.654671121995118,
  minMeanCoverageFraction: 0.895474843578556,
  minDualTargetAllCoveredRate: 0.350063482044689,
};

export async function executeBenchmarkRun(input: {
  datasetId: string;
  clips: TestClip[];
  annotations: Record<string, TestKeyframe[]>;
  signal: AbortSignal;
  onProgress?: (progress: BenchmarkRunnerProgress) => void;
}): Promise<BenchmarkRun> {
  const config = {
    schemaVersion: 2,
    analyzer: "production-smart-follow",
    promotionPolicy: "visibility-first",
    primaryAspectId: "9-16",
    acceptanceGates: PORTRAIT_ACCEPTANCE_GATES,
    run4RegressionFloor: RUN4_PORTRAIT_FLOOR,
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
  const catastrophicRegressions: Array<{ clipId: string; coverageHitDelta: number; coverageDelta: number }> = [];
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
          clipName: clip.name,
          cohorts: resolveClipCohorts(clip),
          sha256: clip.sha256,
          annotationRevision: clip.annotationRevision,
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
        const portraitComparison = output.aspects.find((aspect) => aspect.aspectId === "9-16");
        if (portraitComparison) {
          const coverageHitDelta = portraitComparison.metrics.coverageHitRate - portraitComparison.baselineMetrics.coverageHitRate;
          const coverageDelta = portraitComparison.metrics.meanCoverageFraction - portraitComparison.baselineMetrics.meanCoverageFraction;
          if (coverageDelta < -0.1) {
            catastrophicRegressions.push({ clipId: clip.id, coverageHitDelta, coverageDelta });
          }
        }
        for (const aspect of output.aspects) {
          const relativePath = `clips/${clip.id}/${aspect.aspectId}.jsonl`;
          const detailsPath = await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            relativePath,
            aspect.details.map((detail) => JSON.stringify(detail)).join("\n") + "\n",
          );
          await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            `clips/${clip.id}/${aspect.aspectId}-oracle.json`,
            JSON.stringify(aspect.oracle, null, 2),
          );
          await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            `clips/${clip.id}/${aspect.aspectId}-strategy-comparison.json`,
            JSON.stringify({
              selected: aspect.metrics,
              baseline: aspect.baselineMetrics,
              semanticCandidate: aspect.semanticCandidateMetrics,
              iteration10Candidate: aspect.iteration10CandidateMetrics ?? null,
            }, null, 2),
          );
          await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            `clips/${clip.id}/${aspect.aspectId}-baseline.jsonl`,
            aspect.baselineDetails.map((detail) => JSON.stringify(detail)).join("\n") + "\n",
          );
          await benchmarkPersistenceService.writeArtifact(
            input.datasetId,
            run.id,
            `clips/${clip.id}/${aspect.aspectId}-semantic-candidate.jsonl`,
            aspect.semanticCandidateDetails.map((detail) => JSON.stringify(detail)).join("\n") + "\n",
          );
          if (aspect.iteration10CandidateDetails) {
            await benchmarkPersistenceService.writeArtifact(
              input.datasetId,
              run.id,
              `clips/${clip.id}/${aspect.aspectId}-iteration10-candidate.jsonl`,
              aspect.iteration10CandidateDetails.map((detail) => JSON.stringify(detail)).join("\n") + "\n",
            );
          }
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
    const columnStats = computeBenchmarkColumnStats(await benchmarkPersistenceService.listResults(run.id));
    const cohortStats = computeCohortStats(
      await benchmarkPersistenceService.listResults(run.id),
      input.clips,
    );
    const processedClips = (manifest.clips as Array<{ processingMs?: number }>).filter((clip) => clip.processingMs != null);
    const meanProcessingMs = processedClips.length
      ? processedClips.reduce((sum, clip) => sum + clip.processingMs!, 0) / processedClips.length
      : null;
    const portrait = columnStats.portrait9x16;
    const gateEvaluation = {
      coverageHit: portrait.coverageHit.avg == null ? null : portrait.coverageHit.avg >= PORTRAIT_ACCEPTANCE_GATES.minCoverageHitRate,
      coverage: portrait.coverage.avg == null ? null : portrait.coverage.avg >= PORTRAIT_ACCEPTANCE_GATES.minMeanCoverageFraction,
      dualAllCovered: portrait.dualAllCovered.avg == null ? null : portrait.dualAllCovered.avg >= PORTRAIT_ACCEPTANCE_GATES.minDualTargetAllCoveredRate,
      processingTime: meanProcessingMs == null ? null : meanProcessingMs <= PORTRAIT_ACCEPTANCE_GATES.maxMeanProcessingMs,
      meanProcessingMs,
      passed: false,
      run4Floor: {
        coverageHit: portrait.coverageHit.avg == null ? null : portrait.coverageHit.avg >= RUN4_PORTRAIT_FLOOR.minCoverageHitRate,
        coverage: portrait.coverage.avg == null ? null : portrait.coverage.avg >= RUN4_PORTRAIT_FLOOR.minMeanCoverageFraction,
        dualAllCovered: portrait.dualAllCovered.avg == null ? null : portrait.dualAllCovered.avg >= RUN4_PORTRAIT_FLOOR.minDualTargetAllCoveredRate,
        noCatastrophicRegression: catastrophicRegressions.length === 0,
        passed: false,
      },
    };
    gateEvaluation.passed = [gateEvaluation.coverage, gateEvaluation.dualAllCovered, gateEvaluation.processingTime]
      .every((value) => value === true);
    gateEvaluation.run4Floor.passed = [
      gateEvaluation.run4Floor.coverage,
      gateEvaluation.run4Floor.dualAllCovered,
      gateEvaluation.run4Floor.noCatastrophicRegression,
    ].every((value) => value === true);
    const manifestPath = await benchmarkPersistenceService.writeArtifact(
      input.datasetId,
      run.id,
      "manifest.json",
      JSON.stringify({ ...manifest, completedClips, failedClips, catastrophicRegressions, columnStats, cohortStats, gateEvaluation }, null, 2),
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
