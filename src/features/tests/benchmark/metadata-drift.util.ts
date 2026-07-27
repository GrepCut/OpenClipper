import type { ClipDriftSummary, DriftSummary, FrameMeta } from "./metadata-drift.types";

export const CROP_FRAME_MSE_THRESHOLD = 1e-8;

export function frameMetaFromRow(row: Record<string, unknown>): FrameMeta {
  return { timestampUs: Number(row.timestampUs), layoutMode: row.layoutMode as FrameMeta["layoutMode"], panels: row.panels as FrameMeta["panels"] };
}

export function parseFrameMetaJsonl(contents: string): FrameMeta[] {
  return contents.split("\n").filter((line) => line.trim()).map((line) => frameMetaFromRow(JSON.parse(line) as Record<string, unknown>));
}

function values(panel: FrameMeta["panels"][number]): number[] {
  return [panel.source.x, panel.source.y, panel.source.width, panel.source.height, panel.destination.x, panel.destination.y, panel.destination.width, panel.destination.height];
}

export function compareFrameMetadata(baseline: FrameMeta[], current: FrameMeta[]) {
  const currentByTimestamp = new Map(current.map((frame) => [frame.timestampUs, frame]));
  const baselineTimes = new Set(baseline.map((frame) => frame.timestampUs));
  let sum = 0; let count = 0; let maxFrameMse = 0; let changedFrameCount = 0; let structuralMismatchCount = 0; let comparedFrames = 0;
  for (const base of baseline) {
    const now = currentByTimestamp.get(base.timestampUs);
    if (!now || now.layoutMode !== base.layoutMode || now.panels.length !== base.panels.length) { structuralMismatchCount += 1; changedFrameCount += 1; continue; }
    const left = base.panels.flatMap(values); const right = now.panels.flatMap(values);
    const frameSum = left.reduce((total, value, index) => total + (value - right[index]!) ** 2, 0);
    const frameMse = frameSum / left.length;
    sum += frameSum; count += left.length; comparedFrames += 1; maxFrameMse = Math.max(maxFrameMse, frameMse);
    if (frameMse > CROP_FRAME_MSE_THRESHOLD) changedFrameCount += 1;
  }
  for (const frame of current) if (!baselineTimes.has(frame.timestampUs)) { structuralMismatchCount += 1; changedFrameCount += 1; }
  return { matchesBaseline: structuralMismatchCount === 0 && changedFrameCount === 0, mse: count ? sum / count : null, maxFrameMse: count ? maxFrameMse : null, changedFrameCount, structuralMismatchCount, comparedFrames };
}

export function buildDriftSummary(input: { baselineRunId: string; perClip: ClipDriftSummary[] }): DriftSummary {
  const comparable = input.perClip.filter((entry) => entry.mse != null);
  const comparedFrames = input.perClip.reduce((sum, entry) => sum + entry.comparedFrames, 0);
  return { baselineRunId: input.baselineRunId, matchesBaseline: input.perClip.every((entry) => entry.matchesBaseline), mse: comparable.length ? comparable.reduce((sum, entry) => sum + entry.mse!, 0) / comparable.length : null, maxFrameMse: comparable.length ? Math.max(...comparable.map((entry) => entry.maxFrameMse ?? 0)) : null, changedFrameCount: input.perClip.reduce((sum, entry) => sum + entry.changedFrameCount, 0), structuralMismatchCount: input.perClip.reduce((sum, entry) => sum + entry.structuralMismatchCount, 0), comparedFrames, perClip: input.perClip };
}
