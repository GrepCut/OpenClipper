import type { ClipperClipPreview, ClipperFormatResult } from "./state";

export function sortExportsByDate(results: ClipperFormatResult[]): ClipperFormatResult[] {
  return [...results].sort(
    (a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime(),
  );
}

export function getSessionExportResults(clipPreviews: ClipperClipPreview[]): ClipperFormatResult[] {
  return sortExportsByDate(clipPreviews.flatMap((preview) => preview.results));
}

export function resultsForClip(
  results: ClipperFormatResult[],
  clipIndex: number,
): ClipperFormatResult[] {
  return sortExportsByDate(results.filter((result) => result.clipIndex === clipIndex));
}

export function appendUniqueExportResults(
  existing: ClipperFormatResult[],
  incoming: ClipperFormatResult[],
): ClipperFormatResult[] {
  const seen = new Set(existing.map((result) => result.id));
  const next = [...existing];
  for (const result of incoming) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    next.push(result);
  }
  return sortExportsByDate(next);
}
