import { invoke } from "@tauri-apps/api/core";
import { trimVideoToBuffer, snapToPrecedingKeyframe } from "../lib/media/lossless-trim.util";
import { isTauri } from "../../../shared/utils/platform.util";
import { clipperLog } from "../shared/logger.util";

export const CLIPPER_TRIMMED_SEGMENT_FILE = "clip-trimmed.mp4";
/** Manifest written next to `clip-trimmed.mp4` for GrepCut Studio folder import. */
export const CLIPPER_STUDIO_IMPORT_MANIFEST_FILE = "clipper-studio-import.json";

/** Zero-byte File whose `.path` points at an on-disk file (no fetch/blob). */
export function pathBackedFile(
  filePath: string,
  fileName: string,
  mimeType = "video/mp4",
): File & { path: string } {
  const file = new File([], fileName, { type: mimeType }) as File & { path: string };
  file.path = filePath;
  return file;
}

/** Returns the native filesystem path when `file` is Tauri path-backed, else null. */
export function getNativeFilePath(file: File): string | null {
  const path = (file as File & { path?: string }).path;
  return path ?? null;
}

/** Whether `file` carries a native path (desktop picker / restored segment). */
export function isNativeBacked(file: File): boolean {
  return getNativeFilePath(file) != null;
}

/** Snaps `startSec` to the preceding keyframe — Tauri FFmpeg or browser packet copy. */
export async function snapToKeyframe(file: File, startSec: number): Promise<number> {
  const nativePath = getNativeFilePath(file);
  if (nativePath && isTauri()) {
    return invoke<number>("snap_clipper_to_keyframe", {
      filePath: nativePath,
      startTime: startSec,
    });
  }
  return snapToPrecedingKeyframe(file, startSec);
}

/** Extracts `[start, end)` as an MP4 buffer — native invoke or browser lossless trim. */
export async function extractSegmentBuffer(
  file: File,
  start: number,
  end: number,
  options: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {},
): Promise<ArrayBuffer> {
  const filePath = getNativeFilePath(file);
  if (filePath) {
    if (options.signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
    clipperLog("trim: using native Tauri FFmpeg packet copy", { startSec: start, endSec: end });
    options.onProgress?.(0.1);
    const buffer = await invoke<ArrayBuffer>("extract_clipper_segment", {
      filePath,
      startTime: start,
      endTime: end,
    });
    if (options.signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
    options.onProgress?.(1);
    return buffer;
  }
  clipperLog("trim: using lossless packet copy", { startSec: start, endSec: end });
  return trimVideoToBuffer(file, start, end, {
    signal: options.signal,
    onProgress: ({ stage, ratio }) => {
      clipperLog("trim: progress", { stage, ratio });
      options.onProgress?.(ratio ?? 0);
    },
  });
}

/** Zero-byte File whose `.path` points at an on-disk trimmed segment. */
export function pathBackedClipperFile(filePath: string): File & { path: string } {
  return pathBackedFile(filePath, CLIPPER_TRIMMED_SEGMENT_FILE, "video/mp4");
}
