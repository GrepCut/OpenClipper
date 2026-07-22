import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../../shared/utils/platform.util";
import { getNativeFilePath } from "../platform/native-source.util";
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

export function assertClipperExportUploadSize(
  file: File,
  expectedFileSize: number,
): void {
  if (expectedFileSize > MIN_UPLOAD_BYTES && file.size < MIN_UPLOAD_BYTES) {
    throw new Error(
      `Export file appears empty (${file.size} bytes) but manifest expects ${expectedFileSize} bytes. Try re-exporting the clip.`,
    );
  }
}

/** Materializes in-memory or on-disk clipper exports into a File suitable for multipart upload. */
export async function resolveClipperExportUploadFile(
  result: ClipperFormatResult,
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

  const nativePath =
    (result.file ? getNativeFilePath(result.file) : null) ??
    result.filePath ??
    null;

  if (nativePath && isTauri()) {
    const response = await fetch(convertFileSrc(nativePath));
    if (!response.ok) {
      throw new Error(`Failed to read export file: ${response.statusText}`);
    }
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: "video/mp4" });
    assertClipperExportUploadSize(file, result.fileSize);
    return file;
  }

  return null;
}
