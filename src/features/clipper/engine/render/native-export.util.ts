import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "../../../../shared/utils/platform.util";
import { getNativeFilePath } from "../../platform/native-source.util";
import { clipperLog, clipperWarn } from "../../shared/logger.util";
import type { ClipperQualityPreset } from "../../settings/settings.util";
import type { NativeCropTimeline } from "./crop-timeline.util";

export const CLIPPER_NATIVE_EXPORT_PROGRESS_EVENT = "clipper-native-export-progress";

export interface NativeExportProgressPayload {
  jobId: string;
  ratio: number;
}

export interface NativeExportRequest {
  jobId: string;
  projectId: string;
  inputPath: string;
  outputFileName: string;
  timeline: NativeCropTimeline;
  assContent: string | null;
  captionSceneJson: string | null;
  quality: ClipperQualityPreset;
  muteAudio: boolean;
  durationSec: number;
}

export interface NativeExportResult {
  filePath: string;
  fileSize: number;
  encoder: string;
}

export function canAttemptNativeExport(file: File): boolean {
  return isTauri() && Boolean(getNativeFilePath(file));
}

/** Runs the Rust/FFmpeg native export path. Throws on failure (caller should fall back). */
export async function runNativeClipperExport(
  request: NativeExportRequest,
  options: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {},
): Promise<NativeExportResult> {
  const { signal, onProgress } = options;
  if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<NativeExportProgressPayload>(CLIPPER_NATIVE_EXPORT_PROGRESS_EVENT, (event) => {
      if (event.payload.jobId !== request.jobId) return;
      onProgress?.(Math.min(0.99, Math.max(0, event.payload.ratio)));
    });

    const onAbort = () => {
      void invoke("cancel_clipper_native_export", {
        jobId: request.jobId,
      }).catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      clipperLog("native-export: start", {
        jobId: request.jobId,
        pieces: request.timeline.pieces.length,
        quality: request.quality,
        hasAss: Boolean(request.assContent),
        hasGpuScene: Boolean(request.captionSceneJson),
      });
      const result = await invoke<NativeExportResult>("export_clipper_format_native", {
        jobId: request.jobId,
        projectId: request.projectId,
        inputPath: request.inputPath,
        outputFileName: request.outputFileName,
        timelineJson: JSON.stringify(request.timeline),
        assContent: request.assContent,
        captionSceneJson: request.captionSceneJson,
        quality: request.quality,
        muteAudio: request.muteAudio,
        durationSec: request.durationSec,
      });
      onProgress?.(1);
      clipperLog("native-export: done", {
        jobId: request.jobId,
        encoder: result.encoder,
        fileSize: result.fileSize,
      });
      return result;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    clipperWarn("native-export: failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    unlisten?.();
  }
}
