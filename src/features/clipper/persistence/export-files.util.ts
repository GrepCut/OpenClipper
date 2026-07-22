import { invoke } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import { v5 as uuidv5 } from "uuid";
import { getExportDirectory } from "./project-sync.util";
import { resolveFilePlayableUrl } from '../persistence/tauri-media.util';
import { isTauri } from "../../../shared/utils/platform.util";
import { createFileSystemWriteProxy } from "../lib/convert/file-system-write-proxy.util";
import { getClipperFormatDef } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { clipperLog, clipperWarn } from "../shared/logger.util";
import { pathBackedClipperFile } from "../platform/native-source.util";
import { ensureClipperProjectDataDir } from "./project-data-files.util";

export const CLIPPER_EXPORTS_SUBDIR = "exports";
export const CLIPPER_EXPORTS_MANIFEST = "manifest.json";
export const CLIPPER_WEB_DATA_SUBDIR = "clipper-data";

const MANIFEST_RELATIVE_PATH = `${CLIPPER_EXPORTS_SUBDIR}/${CLIPPER_EXPORTS_MANIFEST}`;

export const CLIPPER_EXPORT_MANIFEST_VERSION = 2;

const LEGACY_EXPORT_NAMESPACE = "a3f2c8e1-4b5d-4e6f-9a0b-1c2d3e4f5a6b";

export interface ClipperExportManifestEntry {
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

interface ClipperExportManifestV1Entry {
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  updatedAt: string;
}

export interface ClipperExportManifest {
  version: typeof CLIPPER_EXPORT_MANIFEST_VERSION;
  exports: ClipperExportManifestEntry[];
}

export interface ClipperDiskExport {
  relativePath: string;
  displayPath: string;
  filePath: string;
  fileSize: number;
  file: File;
  previewUrl: string;
}

export interface ClipperExportSink {
  writable: WritableStream<StreamTargetChunk>;
  relativePath: string;
  fileName: string;
  finalize(): Promise<ClipperDiskExport>;
  abort(): Promise<void>;
}

export function createClipperExportId(): string {
  return crypto.randomUUID();
}

export function legacyClipperExportId(
  projectId: string,
  clipIndex: number,
  formatId: string,
): string {
  return uuidv5(`${projectId}:${clipIndex}:${formatId}`, LEGACY_EXPORT_NAMESPACE);
}

function sanitizeExportFileName(fileName: string): string {
  const base = fileName.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
  return base.endsWith(".mp4") ? base : `${base}.mp4`;
}

function formatExportTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

function migrateManifestToV2(
  projectId: string,
  raw: { version?: number; exports: unknown[] },
): ClipperExportManifest {
  if (raw.version === CLIPPER_EXPORT_MANIFEST_VERSION) {
    return raw as ClipperExportManifest;
  }

  const exports = (raw.exports as ClipperExportManifestV1Entry[]).map((entry) => ({
    id: legacyClipperExportId(projectId, entry.clipIndex, entry.formatId),
    clipIndex: entry.clipIndex,
    formatId: entry.formatId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    width: entry.width,
    height: entry.height,
    fileSize: entry.fileSize,
    exportedAt: entry.updatedAt ?? new Date().toISOString(),
  }));

  return {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports,
  };
}

function chunkBytes(chunk: StreamTargetChunk): Uint8Array {
  return chunk.data;
}

function createTauriExportWritable(projectId: string, fileName: string): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      const bytes = chunkBytes(chunk);
      if (bytes.length === 0) return;
      await invoke("write_clipper_export_file_bytes_at", {
        projectId,
        fileName,
        position: chunk.position,
        contents: bytes,
      });
    },
  });
}

async function ensureWebClipperExportsDir(
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  const clipperDir = await root.getDirectoryHandle(CLIPPER_WEB_DATA_SUBDIR, { create: true });
  return clipperDir.getDirectoryHandle(CLIPPER_EXPORTS_SUBDIR, { create: true });
}

function webDisplayPath(fileName: string, rootName?: string): string {
  const prefix = rootName ? `${rootName}/` : "";
  return `${prefix}${CLIPPER_WEB_DATA_SUBDIR}/${CLIPPER_EXPORTS_SUBDIR}/${fileName}`;
}

async function createWebExportSink(
  projectId: string,
  fileName: string,
): Promise<ClipperExportSink | null> {
  const root = getExportDirectory(projectId);
  if (!root) return null;

  const exportsDir = await ensureWebClipperExportsDir(root);
  const fileHandle = await exportsDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const proxy = createFileSystemWriteProxy(writable);
  const relativePath = `${CLIPPER_EXPORTS_SUBDIR}/${fileName}`;

  return {
    writable: proxy,
    relativePath,
    fileName,
    async finalize(): Promise<ClipperDiskExport> {
      await writable.close();
      const file = await fileHandle.getFile();
      const previewUrl = URL.createObjectURL(file);
      return {
        relativePath,
        displayPath: webDisplayPath(fileName, root.name),
        filePath: relativePath,
        fileSize: file.size,
        file,
        previewUrl,
      };
    },
    async abort(): Promise<void> {
      try {
        await writable.abort();
      } catch {
        // Writable may already be closed.
      }
      try {
        await exportsDir.removeEntry(fileName);
      } catch {
        // Partial file may not exist.
      }
    },
  };
}

async function createTauriExportSink(projectId: string, fileName: string): Promise<ClipperExportSink> {
  await invoke<string>("ensure_clipper_project_exports_dir", { projectId });
  const relativePath = `${CLIPPER_EXPORTS_SUBDIR}/${fileName}`;

  return {
    writable: createTauriExportWritable(projectId, fileName),
    relativePath,
    fileName,
    async finalize(): Promise<ClipperDiskExport> {
      const filePath = await invoke<string>("get_clipper_export_file_path", { projectId, fileName });
      const fileSize = await invoke<number>("stat_clipper_export_file", { projectId, fileName });
      const file = pathBackedClipperFile(filePath);
      const previewUrl = await resolveFilePlayableUrl(file);
      return {
        relativePath,
        displayPath: filePath,
        filePath,
        fileSize,
        file,
        previewUrl,
      };
    },
    async abort(): Promise<void> {
      await invoke("remove_clipper_export_file", { projectId, fileName });
    },
  };
}

/** Creates a disk-backed export sink when storage is available; null → caller uses memory fallback. */
export async function createClipperExportSink(
  projectId: string,
  fileName: string,
): Promise<ClipperExportSink | null> {
  const safeName = sanitizeExportFileName(fileName);
  if (isTauri()) {
    return createTauriExportSink(projectId, safeName);
  }
  return createWebExportSink(projectId, safeName);
}

export async function readClipperExportManifest(projectId: string): Promise<ClipperExportManifest | null> {
  try {
    let raw: { version?: number; exports: unknown[] };

    if (isTauri()) {
      await ensureClipperProjectDataDir(projectId);
      const contents = await invoke<string>("read_clipper_project_data_file", {
        projectId,
        fileName: MANIFEST_RELATIVE_PATH,
      });
      raw = JSON.parse(contents);
    } else {
      const root = getExportDirectory(projectId);
      if (!root) return null;
      const exportsDir = await root
        .getDirectoryHandle(CLIPPER_WEB_DATA_SUBDIR)
        .then((d) => d.getDirectoryHandle(CLIPPER_EXPORTS_SUBDIR));
      const fileHandle = await exportsDir.getFileHandle(CLIPPER_EXPORTS_MANIFEST);
      const file = await fileHandle.getFile();
      raw = JSON.parse(await file.text());
    }

    const manifest = migrateManifestToV2(projectId, raw);
    if (raw.version !== CLIPPER_EXPORT_MANIFEST_VERSION) {
      await writeClipperExportManifest(projectId, manifest);
    }
    return manifest;
  } catch {
    return null;
  }
}

async function writeClipperExportManifest(
  projectId: string,
  manifest: ClipperExportManifest,
): Promise<void> {
  const contents = JSON.stringify(manifest, null, 2);

  if (isTauri()) {
    await ensureClipperProjectDataDir(projectId);
    await invoke("ensure_clipper_project_exports_dir", { projectId });
    await invoke("write_clipper_project_data_file", {
      projectId,
      fileName: MANIFEST_RELATIVE_PATH,
      contents,
    });
    return;
  }

  const root = getExportDirectory(projectId);
  if (!root) return;
  const exportsDir = await ensureWebClipperExportsDir(root);
  const fileHandle = await exportsDir.getFileHandle(CLIPPER_EXPORTS_MANIFEST, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

export async function appendClipperExportManifestEntry(
  projectId: string,
  entry: ClipperExportManifestEntry,
): Promise<void> {
  const existing = (await readClipperExportManifest(projectId)) ?? {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports: [],
  };
  const nextExports = [...existing.exports.filter((item) => item.id !== entry.id), entry];
  nextExports.sort(
    (a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime(),
  );
  await writeClipperExportManifest(projectId, {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports: nextExports,
  });

  void import("./clipper-db-api.util")
    .then(({ createClipperExport }) =>
      createClipperExport(projectId, {
        id: entry.id,
        clipIndex: entry.clipIndex,
        formatId: entry.formatId,
        fileName: entry.fileName,
        relativePath: entry.relativePath,
        width: entry.width,
        height: entry.height,
        fileSize: entry.fileSize,
        exportedAt: entry.exportedAt,
        clipStartSec: entry.clipStartSec,
        clipEndSec: entry.clipEndSec,
      }),
    )
    .catch((error) => {
      clipperWarn("export manifest: DB create failed", { projectId, error });
    });
}

function manifestEntryToMissingResult(
  entry: ClipperExportManifestEntry,
  formatDef: NonNullable<ReturnType<typeof getClipperFormatDef>>,
): ClipperFormatResult {
  return {
    id: entry.id,
    formatId: entry.formatId,
    platform: formatDef.platform,
    label: formatDef.label,
    width: entry.width,
    height: entry.height,
    fileSize: entry.fileSize,
    previewUrl: "",
    clipIndex: entry.clipIndex,
    exportedAt: entry.exportedAt,
    isMissing: true,
    clipStartSec: entry.clipStartSec,
    clipEndSec: entry.clipEndSec,
    relativePath: entry.relativePath,
    displayPath: entry.relativePath,
  };
}

export async function loadClipperExportsFromManifest(
  projectId: string,
  manifest: ClipperExportManifest,
): Promise<ClipperFormatResult[]> {
  const results: ClipperFormatResult[] = [];

  for (const entry of manifest.exports) {
    const formatDef = getClipperFormatDef(entry.formatId);
    if (!formatDef) continue;

    try {
      let previewUrl: string;
      let displayPath: string;
      let filePath: string;
      let file: File | undefined;

      if (isTauri()) {
        filePath = await invoke<string>("get_clipper_export_file_path", {
          projectId,
          fileName: entry.fileName,
        });
        file = pathBackedClipperFile(filePath);
        previewUrl = await resolveFilePlayableUrl(file);
        displayPath = filePath;
      } else {
        const root = getExportDirectory(projectId);
        if (!root) {
          results.push(manifestEntryToMissingResult(entry, formatDef));
          continue;
        }
        const exportsDir = await root
          .getDirectoryHandle(CLIPPER_WEB_DATA_SUBDIR)
          .then((d) => d.getDirectoryHandle(CLIPPER_EXPORTS_SUBDIR));
        const fileHandle = await exportsDir.getFileHandle(entry.fileName);
        file = await fileHandle.getFile();
        previewUrl = URL.createObjectURL(file);
        displayPath = webDisplayPath(entry.fileName, root.name);
        filePath = entry.relativePath;
      }

      results.push({
        id: entry.id,
        formatId: entry.formatId,
        platform: formatDef.platform,
        label: formatDef.label,
        width: entry.width,
        height: entry.height,
        fileSize: entry.fileSize,
        previewUrl,
        clipIndex: entry.clipIndex,
        exportedAt: entry.exportedAt,
        clipStartSec: entry.clipStartSec,
        clipEndSec: entry.clipEndSec,
        relativePath: entry.relativePath,
        displayPath,
        filePath,
        file,
      });
    } catch (error) {
      clipperWarn("export-files: failed to restore export", { entry, error });
      results.push(manifestEntryToMissingResult(entry, formatDef));
    }
  }

  results.sort((a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime());
  clipperLog("export-files: restored exports from manifest", { count: results.length });
  return results;
}

export async function openClipperExportsDir(projectId: string): Promise<string | null> {
  if (isTauri()) {
    return invoke<string>("open_clipper_project_exports_dir", { projectId });
  }
  clipperWarn("export-files: open exports folder is only available in the desktop app");
  return null;
}

export function buildClipperExportFileName(
  template: string,
  sourceStem: string,
  formatId: string,
  clipIndex: number,
  exportedAt: Date = new Date(),
): string {
  const clipNum = String(clipIndex + 1).padStart(2, "0");
  const stem =
    template
      .replace("{name}", sourceStem)
      .replace("{platform}", formatId)
      .replace("{clip}", clipNum) || `${sourceStem}-clip-${clipNum}-${formatId}`;
  const timestamp = formatExportTimestamp(exportedAt);
  const base = stem.endsWith(".mp4") ? stem.slice(0, -4) : stem;
  return sanitizeExportFileName(`${base}-${timestamp}`);
}
