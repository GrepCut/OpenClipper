import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../shared/utils/platform.util";
import type { ClipperFormatResult } from "../shared/state.util";

const MIN_UPLOAD_BYTES = 1024;

export function resolveClipperExportFileName(result: ClipperFormatResult): string {
  const fromDisplayPath = result.displayPath?.split(/[/\\]/).pop();
  if (fromDisplayPath?.endsWith(".mp4")) {
    return fromDisplayPath;
  }
  const fromRelativePath = result.relativePath?.split(/[/\\]/).pop();
  if (fromRelativePath?.endsWith(".mp4")) {
    return fromRelativePath;
  }
  return `${result.formatId}-clip-${result.clipIndex + 1}.mp4`;
}

const SIZE_MISMATCH_TOLERANCE = 0.05;

export function assertClipperExportUploadSize(
  file: File,
  expectedFileSize: number,
): void {
  if (expectedFileSize > MIN_UPLOAD_BYTES && file.size < MIN_UPLOAD_BYTES) {
    throw new Error(
      `Export file appears empty (${file.size} bytes) but manifest expects ${expectedFileSize} bytes. Try re-exporting the clip.`,
    );
  }

  if (expectedFileSize <= MIN_UPLOAD_BYTES) {
    return;
  }

  const ratio = file.size / expectedFileSize;
  if (ratio < 1 - SIZE_MISMATCH_TOLERANCE || ratio > 1 + SIZE_MISMATCH_TOLERANCE) {
    throw new Error(
      `Export file size mismatch (${file.size} bytes vs expected ${expectedFileSize} bytes). Try re-exporting the clip.`,
    );
  }
}

/** Materializes in-memory or on-disk clipper exports into a File suitable for multipart upload. */
export async function resolveClipperExportUploadFile(
  result: ClipperFormatResult,
  projectId: string,
): Promise<File | null> {
  if (result.isMissing) {
    return null;
  }

  const fileName = resolveClipperExportFileName(result);

  if (result.blob) {
    const file = new File([result.blob], fileName, { type: "video/mp4" });
    assertClipperExportUploadSize(file, result.fileSize);
    return file;
  }

  if (result.file && result.file.size > 0) {
    assertClipperExportUploadSize(result.file, result.fileSize);
    return result.file;
  }

  if (isTauri()) {
    const bytes = await invoke<ArrayBuffer>("read_clipper_export_file_bytes", {
      projectId,
      fileName,
    });
    const file = new File([bytes], fileName, { type: "video/mp4" });
    assertClipperExportUploadSize(file, result.fileSize);
    return file;
  }

  return null;
}
