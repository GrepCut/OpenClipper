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
 *   npm run replay:arbiter -- --mode run9 --run <run-8-id>
 *   npm run replay:arbiter -- --mode single --params "{\"proposalMargin\":0.1}"
 *   npm run replay:arbiter -- --mode sweep --grid grids/run6-coarse.json --top 25
 *   npm run replay:arbiter -- --mode loco --grid grids/run6-top.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_ARBITER_PARAMS, RUN9_ARBITER_PARAMS, RUN10_ARBITER_PARAMS, type ArbiterParams } from "../src/features/clipper/engine/autoflip/layout-arbiter";
import { aggregate, replayClip, selfCheck } from "../src/features/tests/benchmark/replay/replay-engine";
import { loadRun } from "../src/features/tests/benchmark/replay/replay-io";
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
  const recordedAggregate = {
    focusHit: manifest.columnStats.portrait9x16.focusHit.avg,
    visibility: manifest.columnStats.portrait9x16.visible.avg,
    dualAllVisible: manifest.columnStats.portrait9x16.dualAllVisible.avg,
  };

  const output: Record<string, unknown> = { datasetId, runId, aspectId, mode };

  if (mode === "self-check") {
    const result = selfCheck(clips, { ...DEFAULT_ARBITER_PARAMS }, aspectId === "9-16"
      ? recordedAggregate
      : { focusHit: null, visibility: null, dualAllVisible: null });
    if (result.passed) {
      console.log("SELF-CHECK PASSED: replay reproduces the recorded run exactly.");
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
    console.log("| Clip | Focus | Visibility | Dual | ΔFocus | ΔVisibility |");
    console.log("|---|---:|---:|---:|---:|---:|");
    for (const [index, result] of evaluated.perClip.entries()) {
      const recorded = clips[index]!.comparison.selected;
      console.log(`| ${result.clipName} | ${pct(result.metrics.focusHitRate)} | ${pct(result.metrics.targetVisibilityRate)} | ${pct(result.metrics.dualTargetAllVisibleRate)} | ${((result.metrics.focusHitRate - recorded.focusHitRate) * 100).toFixed(2)} | ${((result.metrics.targetVisibilityRate - recorded.targetVisibilityRate) * 100).toFixed(2)} |`);
    }
    console.log(`\nAggregate: focus ${pct(evaluated.overall.focusHit)}  visibility ${pct(evaluated.overall.visibility)}  dual ${pct(evaluated.overall.dualAllVisible)}`);
    console.log(`Recorded baseline: focus ${pct(recordedAggregate.focusHit)}  visibility ${pct(recordedAggregate.visibility)}  dual ${pct(recordedAggregate.dualAllVisible)}`);
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
        console.log("\n\n| # | Focus | Visibility | Dual | Gates | Framing |");
        console.log("|---|---:|---:|---:|---|---|");
        for (const [index, result] of results.slice(0, topCount).entries()) {
          console.log(`| ${index + 1} | ${pct(result.overall.focusHit)} | ${pct(result.overall.visibility)} | ${pct(result.overall.dualAllVisible)} | ${result.gates.passed ? "PASS" : `fail: ${result.gates.reasons.join("; ")}`} | ${JSON.stringify(result.framing)} |`);
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
        console.log(`\n\nHeld-out mean: focus ${pct(report.heldOutMean.focusHit)}  visibility ${pct(report.heldOutMean.visibility)}  dual ${pct(report.heldOutMean.dualAllVisible)}`);
        console.log(`Recorded mean: focus ${pct(report.recordedMean.focusHit)}  visibility ${pct(report.recordedMean.visibility)}  dual ${pct(report.recordedMean.dualAllVisible)}`);
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
      console.log(`| # | Focus | Visibility | Dual | Worst ΔF | Worst ΔV | Gates | Params |`);
      console.log("|---|---:|---:|---:|---:|---:|---|---|");
      for (const [index, result] of results.slice(0, topCount).entries()) {
        console.log(`| ${index + 1} | ${pct(result.overall.focusHit)} | ${pct(result.overall.visibility)} | ${pct(result.overall.dualAllVisible)} | ${(result.worstFocusDelta * 100).toFixed(1)} | ${(result.worstVisibilityDelta * 100).toFixed(1)} | ${result.gates.passed ? "PASS" : "fail"} | ${describeParams(result.params)} |`);
      }
      const baseline = evaluateParams(clips, { ...DEFAULT_ARBITER_PARAMS });
      console.log(`\nDefaults for reference: focus ${pct(baseline.overall.focusHit)}  visibility ${pct(baseline.overall.visibility)}  dual ${pct(baseline.overall.dualAllVisible)}`);
      output.top = results.slice(0, topCount).map((result) => ({
        params: result.params,
        overall: result.overall,
        gates: result.gates,
        worstFocusDelta: result.worstFocusDelta,
        worstVisibilityDelta: result.worstVisibilityDelta,
        regressedClips: result.regressedClips,
      }));
    } else {
      const report = leaveOneClipOut(clips, paramSets, RUN5_PORTRAIT_FLOOR, (done, total) => {
        process.stdout.write(`\r  fold ${done}/${total}...`);
      });
      console.log("\n\n| Held-out clip | Focus | Rec. focus | Visibility | Rec. vis. | Chosen params |");
      console.log("|---|---:|---:|---:|---:|---|");
      for (const fold of report.folds) {
        console.log(`| ${fold.heldOutClip} | ${pct(fold.heldOut.focusHit)} | ${pct(fold.recordedHeldOut.focusHit)} | ${pct(fold.heldOut.visibility)} | ${pct(fold.recordedHeldOut.visibility)} | ${describeParams(fold.chosenParams)} |`);
      }
      console.log(`\nHeld-out mean: focus ${pct(report.heldOutMean.focusHit)}  visibility ${pct(report.heldOutMean.visibility)}  dual ${pct(report.heldOutMean.dualAllVisible)}`);
      console.log(`Recorded mean: focus ${pct(report.recordedMean.focusHit)}  visibility ${pct(report.recordedMean.visibility)}  dual ${pct(report.recordedMean.dualAllVisible)}`);
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
