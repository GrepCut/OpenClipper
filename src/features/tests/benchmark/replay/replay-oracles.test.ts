import { describe, expect, it } from "vitest";
import type { ImportanceRegionSample } from "../../../clipper/shared/smart-crop";
import { calculateReplayOracles } from "./replay-oracles";
import type { ReplayedSample } from "./replay-engine";

const viewport = (x: number) => ({ x, y: 0, width: 0.3, height: 1 });
const region = (id: string, x: number, required = true) => ({
  id,
  box: { x, y: 0.2, width: 0.1, height: 0.3 },
  contentBox: { x, y: 0.2, width: 0.1, height: 0.5 },
  kind: "person" as const,
  importanceScore: 0.9,
  confidence: 0.9,
  required,
  role: required ? "primary" as const : "candidate" as const,
  sources: ["person" as const],
});

describe("replay oracle attribution", () => {
  it("assigns exactly one evidence/identity/layout/timing category to every miss", () => {
    const importanceSamples: ImportanceRegionSample[] = [
      { time: 0, regions: [] },
      { time: 0.2, regions: [region("wrong", 0.7, false)] },
      { time: 0.4, regions: [region("target", 0.7)] },
      { time: 0.6, regions: [region("target", 0.7)] },
    ];
    const replaySamples: ReplayedSample[] = importanceSamples.map((sample, index) => ({
      t: sample.time,
      cut: false,
      mode: "single-crop",
      strategy: "semantic-single",
      viewports: [viewport(index === 3 ? 0.65 : 0)],
      requiredRegionIds: index >= 2 ? ["target"] : [],
      reasonCodes: ["test-reason"],
      candidateVariants: index === 2 ? [{ kind: "shifted-crop", mode: "single-crop", viewports: [viewport(0)], requiredCoverage: [0] }] : [],
    }));
    const frames = replaySamples.map((sample) => ({ timestampUs: sample.t * 1_000_000, viewports: sample.viewports, layoutMode: sample.mode }));
    const report = calculateReplayOracles({
      keyframes: [
        { id: "a", timestampUs: 0, targets: [{ id: "t", slot: 0, x: 0.75, y: 0.5, radius: 0.1 }] },
        { id: "b", timestampUs: 600_000, targets: [{ id: "t", slot: 0, x: 0.75, y: 0.5, radius: 0.1 }] },
      ],
      importanceSamples,
      replaySamples,
      frames,
    });
    expect(Object.values(report.missLedger).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(report.missLedger["no-evidence"]).toBe(1);
    expect(report.missLedger["identity-mismatch"]).toBe(1);
    expect(report.missLedger["late-transition"]).toBe(1);
  });
});
