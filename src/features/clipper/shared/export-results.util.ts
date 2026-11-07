import type { ClipperClipPreview, ClipperFormatResult } from "./state.util";

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
  const byId = new Map(existing.map((result) => [result.id, result]));
  for (const result of incoming) {
    byId.set(result.id, result);
  }
  return sortExportsByDate([...byId.values()]);
}
