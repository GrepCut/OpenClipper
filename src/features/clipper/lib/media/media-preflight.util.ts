import { invoke } from "@tauri-apps/api/core";
import { createMediabunnyInput } from "./mediabunny-file-source.util";
import { getNativeFilePath, pathBackedFile } from "../../platform/native-source.util";
import { isTauri } from "../../../../shared/utils/platform.util";
import { createTauriNativeJobId, runTauriNativeJob } from "../../../../shared/utils/tauri-native-jobs.util";

export class MediaPreflightError extends Error {
  constructor(readonly code: "parse-error" | "unsupported-codec" | "missing-file", message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MediaPreflightError";
  }
}

export async function inspectExportMedia(file: File): Promise<void> {
  let input: Awaited<ReturnType<typeof createMediabunnyInput>> | undefined;
  try {
    input = await createMediabunnyInput(file);
    const video = await input.getPrimaryVideoTrack();
    if (!video || !await video.canDecode()) {
      throw new MediaPreflightError("unsupported-codec", "The video codec cannot be decoded by WebView2.");
    }
    const audio = await input.getPrimaryAudioTrack();
    if (audio && !await audio.canDecode()) {
      throw new MediaPreflightError("unsupported-codec", "The audio codec cannot be decoded by WebView2.");
    }
  } catch (error) {
    if (error instanceof MediaPreflightError) throw error;
    if (error instanceof RangeError || (error instanceof Error && error.name === "AbortError")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/missing|inaccessible|not found|404|Cannot resolve media path|Media path is not a file/i.test(message)) {
      throw new MediaPreflightError("missing-file", "Source video is missing or inaccessible. Restore it or select it again. Your clips are preserved.", error);
    }
    // Network/storage failures must not trigger a potentially expensive transcode.
    if (/fetch|byte-range|network|permission|denied/i.test(message)) throw error;
    throw new MediaPreflightError("parse-error", "The source video's container could not be read.", error);
  } finally {
    input?.dispose();
  }
}

const prepared = new WeakMap<File, Promise<File>>();

/** Share concurrent inspection/recovery, but recheck native files on later attempts. */
export async function prepareExportMedia(file: File, projectId: string, signal: AbortSignal,
  onProgress?: (ratio: number) => void): Promise<File> {
  signal.throwIfAborted();
  let request = prepared.get(file);
  if (!request) {
    request = (async () => {
      try {
        await inspectExportMedia(file);
        signal.throwIfAborted();
        return file;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof MediaPreflightError) || error.code === "missing-file") throw error;
        const filePath = getNativeFilePath(file);
        if (!isTauri() || !filePath) throw error;
        onProgress?.(0);
        const result = await runTauriNativeJob<{ ratio: number }, { filePath: string; sourceRevision: string }>({
          jobId: createTauriNativeJobId("media-repair"), startCommand: "start_clipper_media_repair",
          args: { projectId, filePath }, signal, onProgress: (progress) => onProgress?.(progress.ratio),
        });
        signal.throwIfAborted();
        const compatible = pathBackedFile(result.filePath, "clip-compatible.mp4", "video/mp4");
        // Exactly one repair attempt. Never recurse on the repaired file.
        await inspectExportMedia(compatible);
        signal.throwIfAborted();
        const committedPath = await invoke<string>("commit_clipper_prepared_range", {
          projectId,
          preparedFileName: result.filePath.split(/[/\\]/).pop(),
          sourceRevision: result.sourceRevision,
        });
        signal.throwIfAborted();
        return pathBackedFile(committedPath, file.name, "video/mp4");
      }
    })();
    prepared.set(file, request);
    const clear = () => { if (prepared.get(file) === request) prepared.delete(file); };
    void request.then(clear, clear);
  }
  const result = await request;
  signal.throwIfAborted();
  return result;
}
