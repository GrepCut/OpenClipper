/**
 * Measures split-panel jitter on a saved analysis before and after the
 * layout post-pass (stabilisation + smoothing), per split stretch.
 *
 *   npx tsx scripts/measure-split-jitter.ts <smart_crop_analysis.json> [format=9-16]
 *
 * Counts, per stretch: zoom pumps (panel size change > 5% between samples),
 * direction flips of a panel centre (> 1% of the frame each way) and samples
 * whose panel lost its own person (face centre outside the panel).
 */
import { readFileSync } from "node:fs";
import { smoothLayoutTrackSamples } from "../src/features/clipper/engine/autoflip/layout/trajectory-smoothing.util";
import type { ClipperLayoutSample, NormalizedBox } from "../src/features/clipper/shared/smart-crop.util";

const [path, format = "9-16"] = process.argv.slice(2);
if (!path) {
  console.error("usage: tsx scripts/measure-split-jitter.ts <smart_crop_analysis.json> [format]");
  process.exit(1);
}
const analysis = JSON.parse(readFileSync(path, "utf8"));
const original = analysis.layoutTracks[format].samples as ClipperLayoutSample[];
const smoothed = smoothLayoutTrackSamples(original.map((sample) => ({ ...sample, requiredRegionIds: sample.requiredRegionIds ?? [] })));

const cx = (box: NormalizedBox) => box.x + box.width / 2;
const inside = (focus: NormalizedBox, viewport: NormalizedBox) =>
  cx(focus) >= viewport.x && cx(focus) <= viewport.x + viewport.width
  && focus.y + focus.height / 2 >= viewport.y && focus.y + focus.height / 2 <= viewport.y + viewport.height;

function stretches(samples: ClipperLayoutSample[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  samples.forEach((sample, index) => {
    const continues = sample.mode === "split" && start >= 0 && !sample.cut;
    if (start >= 0 && !continues) {
      out.push([start, index - 1]);
      start = -1;
    }
    if (sample.mode === "split" && start < 0) start = index;
  });
  if (start >= 0) out.push([start, samples.length - 1]);
  return out;
}

function measure(samples: ClipperLayoutSample[], from: number, to: number) {
  let pumps = 0;
  let flips = 0;
  let lost = 0;
  let maxStep = 0;
  const lastMove = new Map<number, number>();
  for (let index = from; index <= to; index++) {
    const sample = samples[index]!;
    sample.viewports.forEach((viewport, panel) => {
      const focus = sample.panelSubjects?.[panel]?.focusBox;
      if (focus && !inside(focus, viewport)) lost++;
    });
    if (index === from) continue;
    const previous = samples[index - 1]!;
    if (previous.viewports.length !== sample.viewports.length || sample.speakerCut) continue;
    sample.viewports.forEach((viewport, panel) => {
      const before = previous.viewports[panel]!;
      if (Math.abs(viewport.width - before.width) / Math.max(1e-9, before.width) > 0.05) pumps++;
      const move = cx(viewport) - cx(before);
      maxStep = Math.max(maxStep, Math.abs(move));
      if (Math.abs(move) > 0.01) {
        const last = lastMove.get(panel);
        if (last != null && Math.sign(last) !== Math.sign(move)) flips++;
        lastMove.set(panel, move);
      }
    });
  }
  return { pumps, flips, lost, maxStep };
}

const rows = stretches(original).map(([from, to]) => {
  const seconds = original[to]!.t - original[from]!.t + 0.2;
  const before = measure(original, from, to);
  const after = measure(smoothed, from, to);
  return { start: original[from]!.t, seconds, before, after };
});
const sum = (key: "pumps" | "flips" | "lost", side: "before" | "after") => rows.reduce((total, row) => total + row[side][key], 0);
console.log(`${format}: ${rows.length} split stretches`);
const worst = (side: "before" | "after") => Math.max(...rows.map((row) => row[side].maxStep));
console.log(`largest panel jump per sample: ${worst("before").toFixed(3)} -> ${worst("after").toFixed(3)} (frame widths)`);
console.log(`total  zoom pumps ${sum("pumps", "before")} -> ${sum("pumps", "after")}   direction flips ${sum("flips", "before")} -> ${sum("flips", "after")}   panel lost its person ${sum("lost", "before")} -> ${sum("lost", "after")}`);
for (const row of rows.sort((a, b) => (b.before.pumps + b.before.flips) / b.seconds - (a.before.pumps + a.before.flips) / a.seconds).slice(0, 10)) {
  const rate = (value: { pumps: number; flips: number }) => ((value.pumps + value.flips) / row.seconds).toFixed(1);
  console.log(`  ${row.start.toFixed(1).padStart(6)}s ${row.seconds.toFixed(1).padStart(5)}s  events/s ${rate(row.before)} -> ${rate(row.after)}  max jump ${row.before.maxStep.toFixed(3)} -> ${row.after.maxStep.toFixed(3)}  lost ${row.before.lost} -> ${row.after.lost}`);
}
