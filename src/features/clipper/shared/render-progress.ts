import type { ClipperClipRenderStatus } from "./state";

/** Progress key used by the render pipeline: `${clipIndex}:${formatId}`. */
export function renderProgressKey(clipIndex: number, formatId: string): string {
  return `${clipIndex}:${formatId}`;
}

export type FormatRenderStatus = "waiting" | "starting" | "queued" | "rendering" | "done" | "error";

/** Per-format render status derived from clip-level status and format progress. */
export function deriveFormatRenderStatus(
  clipStatus: ClipperClipRenderStatus,
  formatProgress: number | null,
): FormatRenderStatus {
  if (formatProgress === 1) return "done";
  if (formatProgress != null) return "rendering";
  if (clipStatus === "error") return "error";
  if (clipStatus === "queued") return "queued";
  if (clipStatus === "rendering") return "starting";
  return "waiting";
}

/** Total clip×format export jobs in the render queue. */
export function totalExportJobs(formatIdsByClip: Record<number, string[]>): number {
  let count = 0;
  for (const formatIds of Object.values(formatIdsByClip)) {
    count += formatIds.length;
  }
  return count;
}

/** Number of export jobs that have reached 100% progress. */
export function countCompletedExports(
  renderProgress: Record<string, number | null>,
  formatIdsByClip: Record<number, string[]>,
): number {
  let count = 0;
  for (const [clipIndex, formatIds] of Object.entries(formatIdsByClip)) {
    for (const formatId of formatIds) {
      if (renderProgress[renderProgressKey(Number(clipIndex), formatId)] === 1) {
        count += 1;
      }
    }
  }
  return count;
}

/** Average render progress for one clip across enabled formats, or null if not started. */
export function computeClipProgress(
  renderProgress: Record<string, number | null>,
  clipIndex: number,
  formatIds: string[],
): number | null {
  if (formatIds.length === 0) return null;

  const values: number[] = [];
  for (const formatId of formatIds) {
    const value = renderProgress[renderProgressKey(clipIndex, formatId)];
    if (value != null) values.push(value);
  }

  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Overall render progress across all clips, each weighted by its own format selection (0..1). */
export function computeOverallProgress(
  renderProgress: Record<string, number | null>,
  formatIdsByClip: Record<number, string[]>,
): number {
  let sum = 0;
  let count = 0;
  for (const [clipIndex, formatIds] of Object.entries(formatIdsByClip)) {
    for (const formatId of formatIds) {
      const value = renderProgress[renderProgressKey(Number(clipIndex), formatId)];
      sum += value ?? 0;
      count += 1;
    }
  }

  return count > 0 ? sum / count : 0;
}
