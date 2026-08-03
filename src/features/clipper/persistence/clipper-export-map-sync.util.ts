import type { ClipperExportMapItem } from "./clipper-export-db-api.util";

function missingFieldsKey(fields: string[]): string {
  return fields.join(",");
}

function itemVisualKey(item: ClipperExportMapItem): string {
  return [
    item.id,
    item.projectId,
    item.clipperOwnerId ?? "",
    missingFieldsKey(item.missingFields),
    item.isPublished ? "1" : "0",
    item.publishStatus?.status ?? "",
    item.socialTitle,
    item.socialDescription,
    item.socialHashtags,
  ].join("\0");
}

export function exportMapItemsVisuallyEqual(
  prev: ClipperExportMapItem[],
  next: ClipperExportMapItem[],
): boolean {
  if (prev.length !== next.length) return false;

  const prevById = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) {
    const previous = prevById.get(item.id);
    if (!previous) return false;
    if (itemVisualKey(previous) !== itemVisualKey(item)) return false;
  }

  return true;
}
