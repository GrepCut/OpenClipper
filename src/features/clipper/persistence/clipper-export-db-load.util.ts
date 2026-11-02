import { invoke } from "@tauri-apps/api/core";
import { getClipperFormatDef } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { clipperLog, clipperWarn } from "../shared/logger.util";
import { pathBackedClipperFile } from "../platform/native-source.util";
import { resolveFilePlayableUrl } from "./tauri-media.util";
import {
  fetchClipperExports,
  purgeClipperExportsMissing,
  type ClipperExportRecord,
} from "./clipper-export-db-api.util";
import { metadataFieldsFromExportRecord } from "../hooks/clipper-pipeline/export-manifest-resolve.util";
import { flushPendingClipperExports, getPendingClipperExportResults } from "./clipper-export-persist.util";
import { reportClipperPersistenceError } from "./persistence-error.util";

function recordToMissingResult(
  record: ClipperExportRecord,
  formatDef: NonNullable<ReturnType<typeof getClipperFormatDef>>,
): ClipperFormatResult {
  return {
    id: record.id,
    formatId: record.formatId,
    platform: formatDef.platform,
    label: formatDef.label,
    width: record.width,
    height: record.height,
    fileSize: record.fileSize,
    previewUrl: "",
    clipIndex: record.clipIndex,
    exportedAt: record.exportedAt,
    isMissing: true,
    clipStartSec: record.clipStartSec,
    clipEndSec: record.clipEndSec,
    relativePath: record.relativePath,
    renderSignature: record.renderSignature ?? undefined,
    displayPath: record.relativePath,
    ...metadataFieldsFromExportRecord(record),
  };
}

async function resolveExportRecordMedia(
  projectId: string,
  record: ClipperExportRecord,
): Promise<ClipperFormatResult> {
  const formatDef = getClipperFormatDef(record.formatId);
  if (!formatDef) {
    throw new Error(`Unknown format: ${record.formatId}`);
  }

  try {
    const filePath = await invoke<string>("get_clipper_export_file_path", {
      projectId,
      fileName: record.fileName,
    });
    const file = pathBackedClipperFile(filePath);
    const previewUrl = await resolveFilePlayableUrl(file);
    return {
      id: record.id,
      formatId: record.formatId,
      platform: formatDef.platform,
      label: formatDef.label,
      width: record.width,
      height: record.height,
      fileSize: record.fileSize,
      previewUrl,
      clipIndex: record.clipIndex,
      exportedAt: record.exportedAt,
      clipStartSec: record.clipStartSec,
      clipEndSec: record.clipEndSec,
      relativePath: record.relativePath,
      renderSignature: record.renderSignature ?? undefined,
      displayPath: filePath,
      filePath,
      file,
      ...metadataFieldsFromExportRecord(record),
    };
  } catch (error) {
    clipperWarn("export-db-load: failed to restore export", { record, error });
    return recordToMissingResult(record, formatDef);
  }
}

/** Loads session exports from SQLite and resolves MP4 files on disk. */
export async function loadClipperExportsFromDb(
  projectId: string,
  options: { retryPending?: boolean } = {},
): Promise<ClipperFormatResult[]> {
  if (options.retryPending !== false) {
    await flushPendingClipperExports(projectId).catch(reportClipperPersistenceError);
  }
  await purgeClipperExportsMissing(projectId).catch(() => undefined);
  const records = await fetchClipperExports(projectId).catch(() => [] as ClipperExportRecord[]);

  const results = await Promise.all(
    records.map((record) => resolveExportRecordMedia(projectId, record)),
  );
  const byId = new Map(results.map((result) => [result.id, result]));
  for (const pending of getPendingClipperExportResults(projectId)) byId.set(pending.id, pending);
  const restored = [...byId.values()];

  restored.sort((a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime());
  clipperLog("export-db-load: restored exports from SQLite", { count: restored.length });
  return restored;
}
