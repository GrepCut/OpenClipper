import {
  CLIPPER_FORMAT_DEFS,
  migrateEnabledFormatIds,
  normalizeLegacyFormatId,
} from "./formats.util";

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

    const filtered = migrateEnabledFormatIds(
      formatIds.map((id) => normalizeLegacyFormatId(id)).filter((id) => VALID_FORMAT_IDS.has(id)),
    );
    if (filtered.length > 0) {
      result[clipIndex] = filtered;
    } else if (formatIds.length === 0) {
      result[clipIndex] = [];
    }
  }

  return result;
}

/** Effective format list for one clip (empty until the user selects formats). */
export function resolveClipFormatIds(
  clipIndex: number,
  overrides: Record<number, string[]>,
): string[] {
  return clipIndex in overrides ? overrides[clipIndex]! : [];
}

/** Load per-project render-queue selections only — no implicit defaults. */
export function hydrateRenderQueueSelections(
  saved: Record<number, string[]>,
  clipIndices: Iterable<number>,
): Record<number, string[]> {
  const clipList = [...clipIndices];
  return sanitizeRenderQueueSelections(
    saved,
    clipList.length > 0 ? clipList : undefined,
  );
}

/** Remember format checklist from a per-clip snapshot (when user has selected formats). */
export function deriveRenderQueueFormatTemplate(snapshot: Record<number, string[]>): string[] {
  const lists = Object.values(snapshot).filter((ids) => ids.length > 0);
  if (lists.length === 0) return [];

  const first = lists[0]!;
  const allSame = lists.every(
    (ids) => ids.length === first.length && ids.every((id) => first.includes(id)),
  );
  if (allSame) return [...first];

  const union = new Set<string>();
  for (const ids of lists) {
    for (const id of ids) union.add(id);
  }
  return migrateEnabledFormatIds([...union]);
}

/** Full per-clip snapshot for replace-all render-queue persistence. */
export function buildRenderQueueSnapshot(
  clipIndices: number[],
  overrides: Record<number, string[]>,
): Record<number, string[]> {
  const snapshot: Record<number, string[]> = {};
  for (const clipIndex of clipIndices) {
    snapshot[clipIndex] = resolveClipFormatIds(clipIndex, overrides);
  }
  return sanitizeRenderQueueSelections(snapshot, clipIndices);
}
