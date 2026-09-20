import type { ClipperFormatResult } from "./state.util";

/** Clip bounds tolerance when matching exports that predate stored render signatures. */
const LEGACY_BOUNDS_EPSILON_SEC = 0.05;

export interface ExistingExportClip {
  index: number;
  startSec: number;
  endSec: number;
}

/** Per clip index: formatId → exportedAt (ISO) of the newest matching export on disk. */
export type ExistingExportsByClip = Record<number, Record<string, string>>;

function matchesLegacyBounds(result: ClipperFormatResult, clip: ExistingExportClip): boolean {
  if (result.clipStartSec == null || result.clipEndSec == null) return false;
  return (
    Math.abs(result.clipStartSec - clip.startSec) <= LEGACY_BOUNDS_EPSILON_SEC &&
    Math.abs(result.clipEndSec - clip.endSec) <= LEGACY_BOUNDS_EPSILON_SEC
  );
}

/**
 * Formats already exported from identical render inputs. An export matches a clip when its
 * stored render signature equals the clip's current one; exports without a signature (older
 * renders) fall back to matching clip bounds. Files missing on disk never count.
 */
export function findExistingExports(
  clips: ExistingExportClip[],
  signatures: Record<number, string>,
  exportHistory: ClipperFormatResult[],
): ExistingExportsByClip {
  const existing: ExistingExportsByClip = {};
  const live = exportHistory.filter((result) => !result.isMissing);
  if (live.length === 0) return existing;

  for (const clip of clips) {
    const signature = signatures[clip.index];
    const formats: Record<string, string> = {};
    for (const result of live) {
      const matches = result.renderSignature
        ? result.renderSignature === signature
        : matchesLegacyBounds(result, clip);
      if (!matches) continue;
      const previous = formats[result.formatId];
      if (!previous || previous < result.exportedAt) formats[result.formatId] = result.exportedAt;
    }
    if (Object.keys(formats).length > 0) existing[clip.index] = formats;
  }
  return existing;
}

export function existingFormatIds(
  existing: ExistingExportsByClip,
  clipIndex: number,
): string[] {
  return Object.keys(existing[clipIndex] ?? {});
}
