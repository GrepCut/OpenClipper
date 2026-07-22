import { invoke } from "@tauri-apps/api/core";
import { v5 as uuidv5 } from "uuid";
import { getExportDirectory } from "./project-sync.util";
import { resolveFilePlayableUrl } from "./tauri-media.util";
import { isTauri } from "../../../shared/utils/platform.util";
import { getClipperFormatDef } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { clipperLog, clipperWarn } from "../shared/logger.util";
import { pathBackedClipperFile } from "../platform/native-source.util";
import { ensureClipperProjectDataDir } from "./project-data-files.util";
import {
  ensureWebClipperExportsDir,
  sanitizeExportFileName,
  webDisplayPath,
} from "./clipper-export-sink.util";
import {
  CLIPPER_EXPORT_MANIFEST_VERSION,
  CLIPPER_EXPORTS_MANIFEST,
  CLIPPER_EXPORTS_SUBDIR,
  CLIPPER_WEB_DATA_SUBDIR,
  MANIFEST_RELATIVE_PATH,
  type ClipperExportManifest,
  type ClipperExportManifestEntry,
  type ClipperExportManifestV1Entry,
} from "./export-files.types";

const LEGACY_EXPORT_NAMESPACE = "a3f2c8e1-4b5d-4e6f-9a0b-1c2d3e4f5a6b";

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
