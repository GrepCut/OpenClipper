/**
 * Shadow-only detector segment router evaluation over immutable run artifacts.
 * Candidate geometry is recorded, while routing sees only legal hypothesis
 * features. Ground truth is used solely after routing to score the result.
 */
import type { DetectorSegmentRouterParams } from "../src/features/clipper/engine/autoflip/segment-detector-router";
import { DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS } from "../src/features/clipper/engine/autoflip/segment-detector-router";
import { replayDetectorRouter } from "../src/features/tests/benchmark/replay/detector-router-replay";
import {
  loadRun,
  type ClipArtifacts,
} from "../src/features/tests/benchmark/replay/replay-io";

const DATASET = "b41739b4-b6e4-4c69-b0b8-f1ba7e02a399";
const RUN = "2a9ffda1-180f-4102-a2ae-2724e2cf9a01";
const ASPECTS = ["9-16", "1-1", "4-5", "16-9"] as const;

interface EvaluatedRouter {
  params: DetectorSegmentRouterParams;
  aspects: Record<
    string,
    {
      coverageHit: number;
      coverage: number;
      p5: number;
      contain: number;
      switches: number;
      detectorFrames: number;
    }
  >;
  overallCoverageHit: number;
  overallCoverage: number;
  worstCellDelta: number;
  gateReasons: string[];
}

function mean(values: number[]): number {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  );
}

function evaluate(
  artifacts: ClipArtifacts[],
  params: DetectorSegmentRouterParams,
): EvaluatedRouter {
  const results = artifacts.map((clip) => ({
    clip,
    result: replayDetectorRouter(clip, params, {
      candidateGeometry: "iteration10",
      allowDetectorContain: true,
      requireModeMatch: true,
    }),
  }));
  const aspects: EvaluatedRouter["aspects"] = {};
  let worstCellDelta = 0;
  for (const aspect of ASPECTS) {
    const rows = results.filter(({ clip }) => clip.aspectId === aspect);
    aspects[aspect] = {
      coverageHit: mean(
        rows.map(({ result }) => result.metrics.coverageHitRate),
      ),
      coverage: mean(
        rows.map(({ result }) => result.metrics.meanCoverageFraction),
      ),
      p5: mean(
        rows.map(({ result }) => result.metrics.p5CoverageFraction ?? 0),
      ),
      contain: mean(
        rows.map(({ result }) => result.metrics.containDutyCycle ?? 0),
      ),
      switches: mean(
        rows.map(({ result }) => result.metrics.modeSwitchesPerMinute ?? 0),
      ),
      detectorFrames: mean(rows.map(({ result }) => result.detectorFrameRate)),
    };
    for (const { clip, result } of rows) {
      worstCellDelta = Math.min(
        worstCellDelta,
        result.metrics.coverageHitRate -
          clip.comparison.selected.coverageHitRate,
      );
    }
  }
  const overallCoverageHit = mean(
    ASPECTS.map((aspect) => aspects[aspect]!.coverageHit),
  );
  const overallCoverage = mean(
    ASPECTS.map((aspect) => aspects[aspect]!.coverage),
  );
  const overallContain = mean(
    ASPECTS.map((aspect) => aspects[aspect]!.contain),
  );
  const gateReasons: string[] = [];
  if (worstCellDelta < -0.02 - 1e-6)
    gateReasons.push(`worst cell ${(worstCellDelta * 100).toFixed(2)} pp`);
  const wideRecorded = mean(
    artifacts
      .filter((clip) => clip.aspectId === "16-9")
      .map((clip) => clip.comparison.selected.coverageHitRate),
  );
  if (aspects["16-9"]!.coverageHit < wideRecorded - 0.002 - 1e-6)
    gateReasons.push("16:9 regression");
  if (overallContain > 0.1 + 1e-6)
    gateReasons.push(`contain ${(overallContain * 100).toFixed(2)}%`);
  for (const aspect of ["9-16", "1-1", "4-5"] as const) {
    if (aspects[aspect]!.contain > 0.15 + 1e-6)
      gateReasons.push(
        `${aspect} contain ${(aspects[aspect]!.contain * 100).toFixed(2)}%`,
      );
  }
  const overallSwitches = mean(
    ASPECTS.map((aspect) => aspects[aspect]!.switches),
  );
  if (overallSwitches > 9.04 + 1e-6)
    gateReasons.push(`switches ${overallSwitches.toFixed(2)}/min`);
  return {
    params,
    aspects,
    overallCoverageHit,
    overallCoverage,
    worstCellDelta,
    gateReasons,
  };
}

function paramsGrid(): DetectorSegmentRouterParams[] {
  const result: DetectorSegmentRouterParams[] = [];
  for (const segmentDurationSec of [0.6, 0.8])
    for (const minimumFaceSupport of [0.05])
      for (const minimumPersistence of [0.45, 0.65])
        for (const minimumPersonExcess of [0.5])
          for (const minimumGroupSpread of [0.1])
            for (const enterScore of [1.0])
              for (const minimumHoldSec of [0.4]) {
                result.push({
                  ...DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS,
                  segmentDurationSec,
                  minimumFaceSupport,
                  minimumPersistence,
                  minimumPersonExcess,
                  minimumGroupSpread,
                  enterScore,
                  exitScore: Math.max(0, enterScore - 0.25),
                  minimumHoldSec,
                  weights: {
                    ...DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS.weights,
                  },
                });
              }
  return result;
}

function compareEvaluated(a: EvaluatedRouter, b: EvaluatedRouter): number {
  if (a.gateReasons.length !== b.gateReasons.length)
    return a.gateReasons.length - b.gateReasons.length;
  if (a.worstCellDelta !== b.worstCellDelta)
    return b.worstCellDelta - a.worstCellDelta;
  if (a.overallCoverageHit !== b.overallCoverageHit)
    return b.overallCoverageHit - a.overallCoverageHit;
  return b.overallCoverage - a.overallCoverage;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const artifacts = ASPECTS.flatMap(
  (aspect) => loadRun(DATASET, RUN, aspect).clips,
);
const grid = paramsGrid();
const evaluated = grid.map((params) => evaluate(artifacts, params));
evaluated.sort(compareEvaluated);

console.log(
  "| # | Hit | Coverage | 9:16 | 1:1 | 4:5 | 16:9 | Worst cell | Detector frames | Gates | Params |",
);
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|");
for (const [index, row] of evaluated.slice(0, 20).entries()) {
  console.log(
    `| ${index + 1} | ${pct(row.overallCoverageHit)} | ${pct(row.overallCoverage)} | ${pct(row.aspects["9-16"]!.coverageHit)} | ${pct(row.aspects["1-1"]!.coverageHit)} | ${pct(row.aspects["4-5"]!.coverageHit)} | ${pct(row.aspects["16-9"]!.coverageHit)} | ${(row.worstCellDelta * 100).toFixed(2)} pp | ${pct(mean(ASPECTS.map((aspect) => row.aspects[aspect]!.detectorFrames)))} | ${row.gateReasons.length ? row.gateReasons.join("; ") : "PASS"} | seg=${row.params.segmentDurationSec}, face=${row.params.minimumFaceSupport}, persist=${row.params.minimumPersistence}, excess=${row.params.minimumPersonExcess}, spread=${row.params.minimumGroupSpread}, enter=${row.params.enterScore}, hold=${row.params.minimumHoldSec} |`,
  );
}

const best = evaluated[0]!;
console.log("\nBEST_PARAMS=" + JSON.stringify(best.params));
console.log(
  `BEST_QUALITY: p5(1:1)=${pct(best.aspects["1-1"]!.p5)}, ` +
    `contain=${pct(mean(ASPECTS.map((aspect) => best.aspects[aspect]!.contain)))}, ` +
    `switches=${mean(ASPECTS.map((aspect) => best.aspects[aspect]!.switches)).toFixed(2)}/min`,
);
console.log("\nPer-cell deltas for best candidate:");
for (const clip of artifacts) {
  const result = replayDetectorRouter(clip, best.params, {
    candidateGeometry: "iteration10",
    allowDetectorContain: true,
    requireModeMatch: true,
  });
  const delta =
    result.metrics.coverageHitRate - clip.comparison.selected.coverageHitRate;
  console.log(
    `${clip.dims.name} ${clip.aspectId}: ${(delta * 100).toFixed(2)} pp, ` +
      `detector ${pct(result.detectorFrameRate)}`,
  );
}

console.log("\nLOCO folds:");
const clipIds = [...new Set(artifacts.map((clip) => clip.clipId))];
const stability = new Map<string, number>();
for (const heldOutId of clipIds) {
  const train = artifacts.filter((clip) => clip.clipId !== heldOutId);
  const heldOut = artifacts.filter((clip) => clip.clipId === heldOutId);
  const chosen = grid
    .map((params) => evaluate(train, params))
    .sort(compareEvaluated)[0]!;
  const result = evaluate(heldOut, chosen.params);
  const key = JSON.stringify(chosen.params);
  stability.set(key, (stability.get(key) ?? 0) + 1);
  const recorded = mean(
    heldOut.map((clip) => clip.comparison.selected.coverageHitRate),
  );
  console.log(
    `${heldOut[0]!.dims.name}: ${pct(result.overallCoverageHit)} ` +
      `(Δ ${((result.overallCoverageHit - recorded) * 100).toFixed(2)} pp), ` +
      `worst ${(result.worstCellDelta * 100).toFixed(2)} pp, ` +
      `${result.gateReasons.length ? result.gateReasons.join("; ") : "PASS"}`,
  );
}
console.log(
  "LOCO parameter stability: " +
    [...stability.values()].sort((a, b) => b - a).join(", "),
);
