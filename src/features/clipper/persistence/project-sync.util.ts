import type { ClipperMediaFile } from "./persistence.types";

const exportDirectories = new Map<string, FileSystemDirectoryHandle>();
const inMemoryFiles = new Map<string, File>();

export async function registerProjectDirectory(
  projectId: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  exportDirectories.set(projectId, handle);
}

export function getExportDirectory(
  projectId?: string,
): FileSystemDirectoryHandle | null {
  if (!projectId) return null;
  return exportDirectories.get(projectId) ?? null;
}

export function registerInMemorySourceFile(
  mediaFileId: string,
  file: File,
): void {
  inMemoryFiles.set(mediaFileId, file);
}

export function getInMemorySourceFile(mediaFileId: string): File | null {
  return inMemoryFiles.get(mediaFileId) ?? null;
}

export function createClipperMediaFile(input: {
  id: string;
  file: File;
  duration: number;
  width: number;
  height: number;
  nativePath?: string | null;
}): ClipperMediaFile {
  return {
    id: input.id,
    name: input.file.name,
    relativePath: input.file.name,
    duration: input.duration,
    width: input.width,
    height: input.height,
    sourcePath: input.nativePath ?? null,
    fileType: "video",
  };
}
