import {
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database";
import {
  DEFAULT_CLIPPER_SETTINGS,
  mergeClipperSettings,
  type ClipperSettings,
} from "../settings/settings";

export interface ClipperExportRecord {
  id: string;
  projectId: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  updatedAt: string;
  createdAt: string;
}

export interface CreateClipperExportInput {
  id: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  exportedAt: string;
  clipStartSec?: number;
  clipEndSec?: number;
}

const EXPORTS = "clipper-exports";
const RENDER_QUEUE = "clipper-render-queue";
const SETTINGS = "clipper-settings";

export async function fetchClipperExports(
  projectId: string,
): Promise<ClipperExportRecord[]> {
  return (
    (await localRecordGet<ClipperExportRecord[]>(EXPORTS, projectId)) ?? []
  );
}

export async function createClipperExport(
  projectId: string,
  entry: CreateClipperExportInput,
): Promise<ClipperExportRecord> {
  const exports = await fetchClipperExports(projectId);
  const record: ClipperExportRecord = {
    id: entry.id,
    projectId,
    clipIndex: entry.clipIndex,
    formatId: entry.formatId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    width: entry.width,
    height: entry.height,
    fileSize: entry.fileSize,
    createdAt: entry.exportedAt,
    updatedAt: entry.exportedAt,
  };
  await localRecordPut(EXPORTS, projectId, projectId, [...exports, record]);
  return record;
}

/** @deprecated Use createClipperExport for append-only export history. */
export async function upsertClipperExport(
  projectId: string,
  clipIndex: number,
  formatId: string,
  entry: Omit<
    CreateClipperExportInput,
    "id" | "clipIndex" | "formatId" | "exportedAt"
  > & { fileSize: number },
): Promise<ClipperExportRecord> {
  const exports = await fetchClipperExports(projectId);
  const existing = exports.find(
    (item) => item.clipIndex === clipIndex && item.formatId === formatId,
  );
  const now = new Date().toISOString();
  const record: ClipperExportRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    projectId,
    clipIndex,
    formatId,
    ...entry,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await localRecordPut(EXPORTS, projectId, projectId, [
    ...exports.filter((item) => item.id !== record.id),
    record,
  ]);
  return record;
}

export async function syncClipperExportsBulk(
  projectId: string,
  entries: Array<{
    id: string;
    clipIndex: number;
    formatId: string;
    fileName: string;
    relativePath: string;
    width: number;
    height: number;
    fileSize: number;
    exportedAt: string;
  }>,
): Promise<ClipperExportRecord[]> {
  const records = entries.map((entry) => ({
    ...entry,
    projectId,
    createdAt: entry.exportedAt,
    updatedAt: entry.exportedAt,
  }));
  await localRecordPut(EXPORTS, projectId, projectId, records);
  return records;
}

export async function fetchRenderQueueFormats(
  projectId: string,
): Promise<Record<number, string[]>> {
  return (
    (await localRecordGet<Record<number, string[]>>(RENDER_QUEUE, projectId)) ??
    {}
  );
}

export async function saveRenderQueueFormats(
  projectId: string,
  selections: Record<number, string[]>,
): Promise<Record<number, string[]>> {
  return localRecordPut(RENDER_QUEUE, projectId, projectId, selections);
}

export async function fetchClipperProjectSettings(
  projectId: string,
): Promise<ClipperSettings> {
  const stored = await localRecordGet<Partial<ClipperSettings>>(
    SETTINGS,
    projectId,
  );
  return mergeClipperSettings(DEFAULT_CLIPPER_SETTINGS, stored ?? {});
}

export async function saveClipperProjectSettings(
  projectId: string,
  settings: ClipperSettings,
): Promise<ClipperSettings> {
  return localRecordPut(SETTINGS, projectId, projectId, settings);
}
