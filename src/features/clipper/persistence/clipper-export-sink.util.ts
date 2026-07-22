import { invoke } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import { getExportDirectory } from "./project-sync.util";
import { resolveFilePlayableUrl } from "./tauri-media.util";
import { isTauri } from "../../../shared/utils/platform.util";
import { createFileSystemWriteProxy } from "../lib/convert/file-system-write-proxy.util";
import { pathBackedClipperFile } from "../platform/native-source.util";
import {
  CLIPPER_EXPORTS_SUBDIR,
  CLIPPER_WEB_DATA_SUBDIR,
  type ClipperDiskExport,
  type ClipperExportSink,
} from "./export-files.types";

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

function sanitizeExportFileName(fileName: string): string {
  const base = fileName.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
  return base.endsWith(".mp4") ? base : `${base}.mp4`;
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

export { sanitizeExportFileName, ensureWebClipperExportsDir, webDisplayPath };
