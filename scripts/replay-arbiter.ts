/**
 * Offline arbiter replay over recorded benchmark artifacts. Re-runs the layout
 * arbiter on data persisted by a completed benchmark run — no video decode, no
 * WinML — so threshold candidates can be screened in seconds and validated
 * with leave-one-clip-out before any full benchmark run.
 *
 * Everything is opened read-only; nothing under the dataset directory is
 * modified. Reports go to stdout and (with --out) a JSON file.
 *
 *   npm run replay:arbiter -- --mode self-check
 *   npm run replay:arbiter -- --mode hypothesis-audit --run <run-id>
 *   npm run replay:arbiter -- --mode run9 --run <run-8-id>
 *   npm run replay:arbiter -- --mode single --params "{\"proposalMargin\":0.1}"
 *   npm run replay:arbiter -- --mode sweep --grid grids/run6-coarse.json --top 25
 *   npm run replay:arbiter -- --mode loco --grid grids/run6-top.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_ARBITER_PARAMS, RUN9_ARBITER_PARAMS, RUN10_ARBITER_PARAMS, type ArbiterParams } from "../src/features/clipper/engine/autoflip/layout-arbiter";
import { aggregate, replayClip, selfCheck, SELF_CHECK_METRIC_TOLERANCE } from "../src/features/tests/benchmark/replay/replay-engine";
import { detectorHypothesisSamplesForDebug, loadRun, recordedArbiterParams } from "../src/features/tests/benchmark/replay/replay-io";
import {
  RUN5_PORTRAIT_FLOOR,
  RUN8_PORTRAIT_FLOOR,
  evaluateParams,
  expandGrid,
  expandFramingGrid,
  leaveOneClipOut,
  leaveOneClipOutFraming,
  sweep,
  sweepFraming,
  type ParamGrid,
} from "../src/features/tests/benchmark/replay/replay-sweep";

const DEFAULT_DATASET = "cd986c2a-d998-4a96-afec-218d052d8c78";
const DEFAULT_RUN = "9062956a-ee2a-4aaa-a574-1bc07047fd56";

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(arg.slice(2), next);
      index++;
    } else {
      args.set(arg.slice(2), "true");
    }
  }
  return args;
}

function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function describeParams(params: ArbiterParams): string {
  const diff: string[] = [];
  const defaults = DEFAULT_ARBITER_PARAMS as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(params)) {
    if (JSON.stringify(defaults[key]) !== JSON.stringify(value)) diff.push(`${key}=${JSON.stringify(value)}`);
  }
  return diff.length ? diff.join(" ") : "(defaults)";
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const datasetId = args.get("dataset") ?? DEFAULT_DATASET;
  const runId = args.get("run") ?? DEFAULT_RUN;
  const aspectId = args.get("aspect") ?? "9-16";
  const mode = args.get("mode") ?? "self-check";
  const topCount = Number(args.get("top") ?? 25);

  console.log(`Loading run ${runId} (dataset ${datasetId}, aspect ${aspectId})...`);
  const { manifest, clips } = loadRun(datasetId, runId, aspectId);
  console.log(`Loaded ${clips.length} clips.\n`);
  const portraitStats = manifest.columnStats.portrait9x16 as Record<string, { avg: number | null } | number>;
  const recordedAggregate = {
    coverageHit: (portraitStats.coverageHit as { avg: number | null } | undefined)?.avg
      ?? (portraitStats.focusHit as { avg: number | null } | undefined)?.avg
      ?? null,
    coverage: (portraitStats.coverage as { avg: number | null } | undefined)?.avg
      ?? (portraitStats.visible as { avg: number | null } | undefined)?.avg
      ?? null,
    dualAllCovered: (portraitStats.dualAllCovered as { avg: number | null } | undefined)?.avg
      ?? (portraitStats.dualAllVisible as { avg: number | null } | undefined)?.avg
      ?? null,
  };

  const output: Record<string, unknown> = { datasetId, runId, aspectId, mode };

  if (mode === "hypothesis-audit") {
    console.log("| Clip | Samples | SSD | YOLOX | Conflicts | Ambiguous | Mean agreement | Face support | Pose support |");
    console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    const audit = clips.map((clip) => {
      const samples = detectorHypothesisSamplesForDebug(clip.debug);
      const hypotheses = samples.flatMap((sample) => sample.hypotheses);
      const ssd = hypotheses.filter((hypothesis) => hypothesis.source === "ssd");
      const yolox = hypotheses.filter((hypothesis) => hypothesis.source === "yolox");
      const conflicts = samples.filter((sample) =>
        sample.hypotheses.some((hypothesis) => hypothesis.source === "ssd")
        && sample.hypotheses.some((hypothesis) => hypothesis.source === "yolox")).length;
      const mean = (values: number[]) => values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
      const row = {
        clipId: clip.clipId,
        clipName: clip.dims.name,
        samples: samples.length,
        ssd: ssd.length,
        yolox: yolox.length,
        conflicts,
        ambiguous: hypotheses.filter((hypothesis) => hypothesis.features.identityAmbiguous).length,
        meanAgreement: mean([...ssd, ...yolox].map((hypothesis) => hypothesis.features.detectorAgreementIou)),
        faceSupport: hypotheses.filter((hypothesis) => hypothesis.features.faceSupport > 0).length,
        poseSupport: hypotheses.filter((hypothesis) => hypothesis.features.poseSupport > 0).length,
      };
      console.log(`| ${row.clipName} | ${row.samples} | ${row.ssd} | ${row.yolox} | ${row.conflicts} | ${row.ambiguous} | ${pct(row.meanAgreement)} | ${row.faceSupport} | ${row.poseSupport} |`);
      return row;
    });
    output.hypothesisAudit = audit;
  } else if (mode === "self-check") {
    const recordedParams = recordedArbiterParams(clips[0]!.debug);
    const inconsistentPolicy = clips.some((clip) =>
      JSON.stringify(recordedArbiterParams(clip.debug)) !== JSON.stringify(recordedParams));
    if (inconsistentPolicy) throw new Error("Run contains inconsistent recorded arbiter policies across clips.");
    const result = selfCheck(clips, recordedParams, aspectId === "9-16"
      ? recordedAggregate
      : { coverageHit: null, coverage: null, dualAllCovered: null });
    if (result.passed) {
      console.log(`SELF-CHECK PASSED: strategies are exact and metrics are within ${(SELF_CHECK_METRIC_TOLERANCE * 100).toFixed(2)} pp interpolation tolerance.`);
    } else {
      console.log(`SELF-CHECK FAILED (${result.failures.length} issue(s)):`);
      for (const failure of result.failures.slice(0, 30)) console.log(`  - ${failure}`);
      process.exitCode = 1;
    }
    output.selfCheck = result;
  } else if (mode === "single" || mode === "run9" || mode === "run10") {
    const params: ArbiterParams = {
      ...(mode === "run10" ? RUN10_ARBITER_PARAMS : mode === "run9" ? RUN9_ARBITER_PARAMS : DEFAULT_ARBITER_PARAMS),
      ...(args.has("params") ? JSON.parse(args.get("params")!) as Partial<ArbiterParams> : {}),
    };
    const evaluated = evaluateParams(clips, params, mode === "run9" || mode === "run10" ? RUN8_PORTRAIT_FLOOR : RUN5_PORTRAIT_FLOOR);
    console.log(`Params: ${describeParams(params)}\n`);
    console.log("| Clip | Cov hit | Coverage | Dual | ΔHit | ΔCov |");
    console.log("|---|---:|---:|---:|---:|---:|");
    for (const [index, result] of evaluated.perClip.entries()) {
      const recorded = clips[index]!.comparison.selected;
      console.log(`| ${result.clipName} | ${pct(result.metrics.coverageHitRate)} | ${pct(result.metrics.meanCoverageFraction)} | ${pct(result.metrics.dualTargetAllCoveredRate)} | ${((result.metrics.coverageHitRate - recorded.coverageHitRate) * 100).toFixed(2)} | ${((result.metrics.meanCoverageFraction - recorded.meanCoverageFraction) * 100).toFixed(2)} |`);
    }
    console.log(`\nAggregate: covHit ${pct(evaluated.overall.coverageHit)}  coverage ${pct(evaluated.overall.coverage)}  dual ${pct(evaluated.overall.dualAllCovered)}`);
    console.log(`Recorded baseline: covHit ${pct(recordedAggregate.coverageHit)}  coverage ${pct(recordedAggregate.coverage)}  dual ${pct(recordedAggregate.dualAllCovered)}`);
    console.log(`Quality: contain ${pct(evaluated.overall.containDutyCycle)}  switches ${(evaluated.overall.modeSwitchesPerMinute ?? 0).toFixed(2)}/min`);
    console.log(`Gates: ${evaluated.gates.passed ? "PASS" : `FAIL (${evaluated.gates.reasons.join("; ")})`}`);
    if (evaluated.regressedClips.length) console.log(`Soft-flagged clips (>5 pp drop): ${evaluated.regressedClips.join(", ")}`);
    output.evaluated = evaluated;
    if (mode === "run10") {
      output.oracles = evaluated.perClip.map((result) => ({ clipId: result.clipId, clipName: result.clipName, ...result.oracles }));
    }
  } else if (mode === "sweep" || mode === "loco" || mode === "framing-sweep" || mode === "framing-loco") {
    if (!args.has("grid")) throw new Error(`--grid <file.json> is required for mode ${mode}.`);
    const grid = JSON.parse(readFileSync(resolve(args.get("grid")!), "utf8")) as ParamGrid;
    if (mode === "framing-sweep" || mode === "framing-loco") {
      const framingSets = expandFramingGrid(grid);
      const framingArbiterParams: ArbiterParams = {
        ...DEFAULT_ARBITER_PARAMS,
        ...(args.has("params") ? JSON.parse(args.get("params")!) as Partial<ArbiterParams> : {}),
      };
      console.log(`Framing grid: ${Object.keys(grid).join(", ")} → ${framingSets.length} combinations.\n`);
      if (mode === "framing-sweep") {
        const results = sweepFraming(clips, framingSets, framingArbiterParams, RUN5_PORTRAIT_FLOOR, (done, total) => {
          process.stdout.write(`\r  evaluated ${done}/${total}...`);
        });
        console.log("\n\n| # | Cov hit | Coverage | Dual | Gates | Framing |");
        console.log("|---|---:|---:|---:|---|---|");
        for (const [index, result] of results.slice(0, topCount).entries()) {
          console.log(`| ${index + 1} | ${pct(result.overall.coverageHit)} | ${pct(result.overall.coverage)} | ${pct(result.overall.dualAllCovered)} | ${result.gates.passed ? "PASS" : `fail: ${result.gates.reasons.join("; ")}`} | ${JSON.stringify(result.framing)} |`);
        }
        output.top = results.slice(0, topCount).map((result) => ({
          framing: result.framing,
          overall: result.overall,
          gates: result.gates,
          catastrophicClips: result.catastrophicClips,
          regressedClips: result.regressedClips,
        }));
      } else {
        const report = leaveOneClipOutFraming(clips, framingSets, framingArbiterParams, RUN5_PORTRAIT_FLOOR, (done, total) => {
          process.stdout.write(`\r  fold ${done}/${total}...`);
        });
        console.log(`\n\nHeld-out mean: covHit ${pct(report.heldOutMean.coverageHit)}  coverage ${pct(report.heldOutMean.coverage)}  dual ${pct(report.heldOutMean.dualAllCovered)}`);
        console.log(`Recorded mean: covHit ${pct(report.recordedMean.coverageHit)}  coverage ${pct(report.recordedMean.coverage)}  dual ${pct(report.recordedMean.dualAllCovered)}`);
        console.log("Framing-choice stability across folds:");
        for (const entry of report.framingStability) console.log(`  ${entry.folds}/${clips.length}: ${JSON.stringify(entry.framing)}`);
        output.framingLoco = report;
      }
      if (args.has("out")) {
        const outPath = resolve(args.get("out")!);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, JSON.stringify(output, null, 2));
        console.log(`\nFull report written to ${outPath}`);
      }
      return;
    }
    const paramSets = expandGrid(grid);
    console.log(`Grid: ${Object.keys(grid).join(", ")} → ${paramSets.length} combinations.\n`);
    if (mode === "sweep") {
      const started = Date.now();
      const results = sweep(clips, paramSets, RUN5_PORTRAIT_FLOOR, (done, total) => {
        if (done % 50 === 0 || done === total) process.stdout.write(`\r  evaluated ${done}/${total}...`);
      });
      console.log(`\n  done in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);
      console.log(`| # | Cov hit | Coverage | Dual | Worst ΔHit | Worst ΔCov | Gates | Params |`);
      console.log("|---|---:|---:|---:|---:|---:|---|---|");
      for (const [index, result] of results.slice(0, topCount).entries()) {
        console.log(`| ${index + 1} | ${pct(result.overall.coverageHit)} | ${pct(result.overall.coverage)} | ${pct(result.overall.dualAllCovered)} | ${(result.worstCoverageHitDelta * 100).toFixed(1)} | ${(result.worstCoverageDelta * 100).toFixed(1)} | ${result.gates.passed ? "PASS" : "fail"} | ${describeParams(result.params)} |`);
      }
      const baseline = evaluateParams(clips, { ...DEFAULT_ARBITER_PARAMS });
      console.log(`\nDefaults for reference: covHit ${pct(baseline.overall.coverageHit)}  coverage ${pct(baseline.overall.coverage)}  dual ${pct(baseline.overall.dualAllCovered)}`);
      output.top = results.slice(0, topCount).map((result) => ({
        params: result.params,
        overall: result.overall,
        gates: result.gates,
        worstCoverageHitDelta: result.worstCoverageHitDelta,
        worstCoverageDelta: result.worstCoverageDelta,
        regressedClips: result.regressedClips,
      }));
    } else {
      const report = leaveOneClipOut(clips, paramSets, RUN5_PORTRAIT_FLOOR, (done, total) => {
        process.stdout.write(`\r  fold ${done}/${total}...`);
      });
      console.log("\n\n| Held-out clip | Cov hit | Rec. hit | Coverage | Rec. cov | Chosen params |");
      console.log("|---|---:|---:|---:|---:|---|");
      for (const fold of report.folds) {
        console.log(`| ${fold.heldOutClip} | ${pct(fold.heldOut.coverageHit)} | ${pct(fold.recordedHeldOut.coverageHit)} | ${pct(fold.heldOut.coverage)} | ${pct(fold.recordedHeldOut.coverage)} | ${describeParams(fold.chosenParams)} |`);
      }
      console.log(`\nHeld-out mean: covHit ${pct(report.heldOutMean.coverageHit)}  coverage ${pct(report.heldOutMean.coverage)}  dual ${pct(report.heldOutMean.dualAllCovered)}`);
      console.log(`Recorded mean: covHit ${pct(report.recordedMean.coverageHit)}  coverage ${pct(report.recordedMean.coverage)}  dual ${pct(report.recordedMean.dualAllCovered)}`);
      console.log("\nParam-choice stability across folds:");
      for (const entry of report.paramStability) {
        console.log(`  ${entry.folds}/18 folds: ${describeParams(entry.params)}`);
      }
      output.loco = report;
    }
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  if (args.has("out")) {
    const outPath = resolve(args.get("out")!);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nFull report written to ${outPath}`);
  }
}

main();
