import type { ClipperClipBounds } from "../engine/types/segmentation.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseClipperClipBounds(value: unknown): ClipperClipBounds | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.index !== "number" ||
    typeof value.startSec !== "number" ||
    typeof value.endSec !== "number"
  ) {
    return null;
  }
  return { index: value.index, startSec: value.startSec, endSec: value.endSec };
}

export function parseClipperClipBoundsList(value: unknown): ClipperClipBounds[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: ClipperClipBounds[] = [];
  for (const item of value) {
    const bounds = parseClipperClipBounds(item);
    if (bounds) parsed.push(bounds);
  }
  return parsed;
}
