import { CLIPPER_FORMAT_DEFS } from "./formats.util";

const VALID_FORMAT_IDS = new Set(CLIPPER_FORMAT_DEFS.map((def) => def.id));

/** Keeps only known platform IDs and optional clip indices. */
export function sanitizeRenderQueueSelections(
  selections: Record<number, string[]>,
  validClipIndices?: Iterable<number>,
): Record<number, string[]> {
  const clipList = validClipIndices ? [...validClipIndices] : null;
  const clipSet = clipList && clipList.length > 0 ? new Set(clipList) : null;
  const result: Record<number, string[]> = {};

  for (const [key, formatIds] of Object.entries(selections)) {
    const clipIndex = Number(key);
    if (!Number.isInteger(clipIndex) || clipIndex < 0) continue;
    if (clipSet && !clipSet.has(clipIndex)) continue;
    if (!Array.isArray(formatIds)) continue;

    const filtered = formatIds.filter((id) => VALID_FORMAT_IDS.has(id));
    if (filtered.length > 0) {
      result[clipIndex] = filtered;
    } else if (formatIds.length === 0) {
      result[clipIndex] = [];
    }
  }

  return result;
}

/** Effective format list for one clip (override or project defaults). */
export function resolveClipFormatIds(
  clipIndex: number,
  overrides: Record<number, string[]>,
  defaultFormatIds: string[],
): string[] {
  return clipIndex in overrides ? overrides[clipIndex] : [...defaultFormatIds];
}

/** Full per-clip snapshot for replace-all render-queue persistence. */
export function buildRenderQueueSnapshot(
  clipIndices: number[],
  overrides: Record<number, string[]>,
  defaultFormatIds: string[],
): Record<number, string[]> {
  const snapshot: Record<number, string[]> = {};
  for (const clipIndex of clipIndices) {
    snapshot[clipIndex] = resolveClipFormatIds(clipIndex, overrides, defaultFormatIds);
  }
  return sanitizeRenderQueueSelections(snapshot, clipIndices);
}
