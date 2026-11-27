/**
 * Offline replay of the AutoFlip framing for one analysed project.
 *
 * Dev builds write `autoflip_input.json` (the exact `buildAutoFlipTrack` input)
 * into the project's data folder. This tool re-runs the real framing code on
 * it, so framing changes can be checked in seconds instead of re-running the
 * multi-minute native analysis.
 *
 *   npx tsx scripts/replay-autoflip.ts <autoflip_input.json | project data dir>
 *       [--words <words.json>]   transcript words [{ text, start, end }] shown per turn
 *       [--turns]                print every speaker turn
 *       [--no-regression]        also replay without ASD scores and compare all
 *                                layout samples outside conversation stretches
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildAutoFlipTrack } from "../src/features/clipper/engine/autoflip/build-track.util";
import { attachFaceCacheEvidence } from "../src/features/clipper/engine/autoflip/face-cache-evidence.util";
import { buildCanonicalPersonTracks } from "../src/features/clipper/engine/autoflip/identity/canonical-person.util";
import { applyActiveSpeakerPolicy } from "../src/features/clipper/engine/autoflip/identity/active-speaker.util";
import { detectConversationSpans } from "../src/features/clipper/engine/autoflip/layout/conversation-layout.util";
import type { BuildAutoFlipTrackInput } from "../src/features/clipper/engine/types/autoflip.types";
import type { ClipperLayoutSample, NormalizedBox } from "../src/features/clipper/shared/smart-crop.util";

interface Word { text: string; start: number; end: number }

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--words");
if (!target) {
  console.error("usage: tsx scripts/replay-autoflip.ts <autoflip_input.json | project data dir> [--words file] [--turns] [--no-regression]");
  process.exit(1);
}
const inputPath = statSync(target).isDirectory() ? join(target, "autoflip_input.json") : target;
if (!existsSync(inputPath)) {
  console.error(`missing ${inputPath} — run a fresh analysis in a dev build first`);
  process.exit(1);
}
const wordsIndex = args.indexOf("--words");
const words: Word[] = wordsIndex >= 0 ? JSON.parse(readFileSync(args[wordsIndex + 1]!, "utf8")) : [];
const input = JSON.parse(readFileSync(inputPath, "utf8")) as BuildAutoFlipTrackInput;

const fmt = (value: number) => value.toFixed(1).padStart(6);
const cx = (box: NormalizedBox) => box.x + box.width / 2;
const textBetween = (start: number, end: number, limit = 90) => {
  const text = words.filter((word) => word.start >= start && word.start < end).map((word) => word.text.trim()).join(" ");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

// ---- speaker evidence and turns (same steps as buildAutoFlipTrack) ----
const withFaces = attachFaceCacheEvidence(input.detections, input.faces, input.sceneCuts);
const canonical = buildCanonicalPersonTracks(withFaces);
const speaker = applyActiveSpeakerPolicy(canonical.samples);
console.log(`clip ${input.clipStart}–${input.clipEnd}s, ${input.detections.length} samples`);
console.log("ASD telemetry", speaker.telemetry);

const perTrack = new Map<number, number[]>();
for (const sample of canonical.samples) {
  for (const score of sample.activeSpeakerScores ?? []) {
    perTrack.set(score.trackId, [...(perTrack.get(score.trackId) ?? []), score.confidence]);
  }
}
const pct = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(fraction * (sorted.length - 1))] ?? 0;
};
console.log("\nLight-ASD probability per canonical track (p10 / p50 / p90, samples):");
for (const [track, values] of [...perTrack].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  console.log(`  track ${String(track).padStart(4)}  ${pct(values, 0.1).toFixed(2)} / ${pct(values, 0.5).toFixed(2)} / ${pct(values, 0.9).toFixed(2)}  n=${values.length}`);
}
console.log(`\nspeaker turns: ${speaker.turns.segments.length}; speaking seconds per track:`,
  Object.fromEntries([...speaker.turns.speakingSecondsByTrack].map(([track, seconds]) => [track, Math.round(seconds)])));
if (args.includes("--turns")) {
  for (const segment of speaker.turns.segments) {
    console.log(`  ${fmt(segment.start)}–${fmt(segment.end)}  track ${segment.trackId}${segment.turnStart ? " *" : "  "}  ${textBetween(segment.start, segment.end)}`);
  }
}

// ---- conversation stretches ----
const spans = detectConversationSpans({
  samples: canonical.samples,
  turns: speaker.turns,
  clipStart: input.clipStart,
  clipEnd: input.clipEnd,
  sceneCuts: input.sceneCuts,
});
const covered = spans.reduce((sum, span) => sum + span.end - span.start, 0);
console.log(`\nconversation stretches: ${spans.length}, ${(100 * covered / Math.max(1e-9, input.clipEnd - input.clipStart)).toFixed(1)}% of the clip`);
for (const span of spans) {
  const slots = span.slots.map((slot) => `${slot.id.split(":").at(-1)}@x${cx(slot.faceBox).toFixed(2)}[${slot.trackIds.join(",")}]`).join(" ");
  console.log(`  ${fmt(span.start)}–${fmt(span.end)}  people: ${slots}  lead changes: ${span.leads.length - 1}`);
  if (args.includes("--turns")) {
    span.leads.forEach((lead, index) => {
      const end = span.leads[index + 1]?.time ?? span.end;
      console.log(`      ${fmt(lead.time)}–${fmt(end)} lead ${lead.slotId.split(":").at(-1)}  ${textBetween(lead.time, end)}`);
    });
  }
}

// ---- layout statistics per format ----
function stats(samples: ClipperLayoutSample[]) {
  const modes = new Map<string, number>();
  let modeSwitches = 0;
  let jumps = 0;
  let leadChanges = 0;
  let inConversation = 0;
  samples.forEach((sample, index) => {
    const key = `${sample.mode}:${sample.viewports.length}`;
    modes.set(key, (modes.get(key) ?? 0) + 1);
    if (sample.reasonCodes?.includes("conversation-layout")) inConversation++;
    const previous = samples[index - 1];
    if (!previous) return;
    if (`${previous.mode}:${previous.viewports.length}` !== key) modeSwitches++;
    else if (sample.mode === "split" && previous.panelSubjects?.[0]?.id !== sample.panelSubjects?.[0]?.id) leadChanges++;
    else if (!sample.cut && sample.viewports.some((viewport, viewportIndex) =>
      Math.abs(cx(viewport) - cx(previous.viewports[viewportIndex]!)) > 0.05)) jumps++;
  });
  return { modes: Object.fromEntries(modes), modeSwitches, leadChanges, jumpsOver5pct: jumps, conversationSamples: inConversation };
}

const blob = buildAutoFlipTrack(input);
console.log("\nlayout per format:");
for (const [format, track] of Object.entries(blob.layoutTracks ?? {})) {
  console.log(`  ${format.padEnd(6)}`, stats(track.samples));
}

// ---- regression guard: outside conversations, ASD must change nothing ----
if (args.includes("--no-regression")) {
  const stripped: BuildAutoFlipTrackInput = {
    ...input,
    detections: input.detections.map((sample) => ({ ...sample, activeSpeakerScores: undefined })),
  };
  const baseline = buildAutoFlipTrack(stripped);
  const inside = (time: number) => spans.some((span) => time >= span.start - 1e-9 && time < span.end - 1e-9);
  console.log("\nregression guard (samples outside conversations that differ without ASD):");
  for (const [format, track] of Object.entries(blob.layoutTracks ?? {})) {
    const other = baseline.layoutTracks?.[format]?.samples ?? [];
    let compared = 0;
    let differing = 0;
    track.samples.forEach((sample, index) => {
      if (inside(sample.t)) return;
      compared++;
      const reference = other[index];
      const same = reference != null
        && reference.mode === sample.mode
        && JSON.stringify(reference.viewports) === JSON.stringify(sample.viewports);
      if (!same) differing++;
    });
    console.log(`  ${format.padEnd(6)} compared ${compared}, differing ${differing}`);
  }
}
