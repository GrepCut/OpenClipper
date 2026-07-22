import { fetchClipperExports, syncClipperExportsBulk } from "../../persistence/clipper-db-api.util";
import {
  CLIPPER_EXPORT_MANIFEST_VERSION,
  readClipperExportManifest,
  type ClipperExportManifest,
} from "../../persistence/export-files.util";
import { clipperError } from "../../shared/logger.util";

export function manifestFromDbExports(
  exports: Awaited<ReturnType<typeof fetchClipperExports>>,
): ClipperExportManifest {
  return {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports: exports.map((record) => ({
      id: record.id,
      clipIndex: record.clipIndex,
      formatId: record.formatId,
      fileName: record.fileName,
      relativePath: record.relativePath,
      width: record.width,
      height: record.height,
      fileSize: record.fileSize,
      exportedAt: record.createdAt,
    })),
  };
}

export function mergeExportManifests(
  diskManifest: ClipperExportManifest | null,
  dbManifest: ClipperExportManifest | null,
): ClipperExportManifest | null {
  const byId = new Map<string, ClipperExportManifest["exports"][number]>();
  for (const entry of diskManifest?.exports ?? []) {
    byId.set(entry.id, entry);
  }
  for (const entry of dbManifest?.exports ?? []) {
    byId.set(entry.id, entry);
  }
  if (byId.size === 0) return null;
  return {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports: [...byId.values()].sort(
      (a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime(),
    ),
  };
}

export async function resolveClipperExportManifest(
  projectId: string,
): Promise<ClipperExportManifest | null> {
  const [diskManifest, dbExports] = await Promise.all([
    readClipperExportManifest(projectId),
    fetchClipperExports(projectId).catch(() => [] as Awaited<ReturnType<typeof fetchClipperExports>>),
  ]);

  const dbManifest = dbExports.length > 0 ? manifestFromDbExports(dbExports) : null;
  const merged = mergeExportManifests(diskManifest, dbManifest);

  if (dbExports.length === 0 && diskManifest?.exports.length) {
    void syncClipperExportsBulk(projectId, diskManifest.exports).catch((error) => {
      clipperError("pipeline: export DB backfill failed", error);
    });
    return diskManifest;
  }

  return merged;
}
