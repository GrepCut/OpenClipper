import type { ClipperLayoutMode } from "../../clipper/shared/smart-crop.util";
import { REPLAY_METRIC_TOLERANCE } from "./replay/replay-tolerance.util";
import type { ClipDriftSummary, DriftSummary, FrameMeta } from "./metadata-drift.types";

function viewportMatches(
  a: FrameMeta["viewports"][number],
  b: FrameMeta["viewports"][number],
  tolerance: number,
): boolean {
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance;
}

function reasonCodesMatch(a?: string[], b?: string[]): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  if (left.length !== right.length) return false;
  return left.every((code, index) => code === right[index]);
}

export function frameMetaFromRow(row: Record<string, unknown>): FrameMeta {
  return {
    timestampUs: Number(row.timestampUs),
    layoutMode: row.layoutMode as ClipperLayoutMode,
    viewports: row.viewports as FrameMeta["viewports"],
    reasonCodes: row.reasonCodes as string[] | undefined,
  };
}

export function parseFrameMetaJsonl(contents: string): FrameMeta[] {
  return contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => frameMetaFromRow(JSON.parse(line) as Record<string, unknown>));
}

export function frameMetaMatches(
  baseline: FrameMeta,
  current: FrameMeta,
  tolerance = REPLAY_METRIC_TOLERANCE,
): boolean {
  if (baseline.layoutMode !== current.layoutMode) return false;
  if (baseline.viewports.length !== current.viewports.length) return false;
  if (!reasonCodesMatch(baseline.reasonCodes, current.reasonCodes)) return false;
  return baseline.viewports.every((viewport, index) =>
    viewportMatches(viewport, current.viewports[index]!, tolerance));
}

function alignFramesByTimestamp(
  baseline: FrameMeta[],
  current: FrameMeta[],
): Array<{ baseline: FrameMeta; current: FrameMeta }> {
  const currentByTimestamp = new Map(current.map((frame) => [frame.timestampUs, frame]));
  const pairs: Array<{ baseline: FrameMeta; current: FrameMeta }> = [];
  for (const base of baseline) {
    const match = currentByTimestamp.get(base.timestampUs);
    if (match) pairs.push({ baseline: base, current: match });
  }
  return pairs;
}

export function compareFrameMetadata(
  baseline: FrameMeta[],
  current: FrameMeta[],
): { matchPct: number; driftPct: number; matchingFrames: number; comparedFrames: number } {
  const pairs = alignFramesByTimestamp(baseline, current);
  const comparedFrames = pairs.length;
  if (comparedFrames === 0) {
    return { matchPct: 0, driftPct: 1, matchingFrames: 0, comparedFrames: 0 };
  }
  const matchingFrames = pairs.filter((pair) => frameMetaMatches(pair.baseline, pair.current)).length;
  const matchPct = matchingFrames / comparedFrames;
  return {
    matchPct,
    driftPct: 1 - matchPct,
    matchingFrames,
    comparedFrames,
  };
}

export function buildDriftSummary(input: {
  baselineRunId: string;
  primaryAspectId: string;
  perClip: ClipDriftSummary[];
}): DriftSummary {
  const comparedFrames = input.perClip.reduce((sum, clip) => sum + clip.comparedFrames, 0);
  const matchingFrames = input.perClip.reduce((sum, clip) => sum + clip.matchingFrames, 0);
  const matchPct = comparedFrames > 0 ? matchingFrames / comparedFrames : 0;
  return {
    baselineRunId: input.baselineRunId,
    primaryAspectId: input.primaryAspectId,
    matchPct,
    driftPct: 1 - matchPct,
    matchingFrames,
    comparedFrames,
    perClip: input.perClip,
  };
}

// ponytail: assert-based self-check; upgrade path = vitest if this grows
export function metadataDriftSelfCheck(): void {
  const frame: FrameMeta = {
    timestampUs: 1_000_000,
    layoutMode: "single-crop",
    viewports: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    reasonCodes: ["a"],
  };
  const identical = compareFrameMetadata([frame], [{ ...frame }]);
  console.assert(identical.matchPct === 1, "identical frames should fully match");

  const drifted = compareFrameMetadata(
    [frame],
    [{
      ...frame,
      viewports: [{ x: 0.1, y: 0.2, width: 0.3 + REPLAY_METRIC_TOLERANCE + 0.001, height: 0.4 }],
    }],
  );
  console.assert(drifted.matchPct === 0, "viewport drift beyond tolerance should not match");
}
