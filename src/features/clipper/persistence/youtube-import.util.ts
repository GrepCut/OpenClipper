import { invoke } from "@tauri-apps/api/core";
import * as Sentry from "@sentry/react";
import { isTauri } from "../../../shared/utils/platform.util";
import {
  createTauriNativeJobId,
  runTauriNativeJob,
  TauriNativeJobError,
} from "../../../shared/utils/tauri-native-jobs.util";
import { pathBackedFile } from "../platform/native-source.util";
import { withClipperProjectWrite } from "./project-write-lifecycle.util";

export const YOUTUBE_IMPORT_TERMS = "https://grepcut.com/en/terms-of-service/open-clipper#youtube-import";

export interface YouTubeImportProgress {
  phase: "resolve" | "download" | "prepare";
  ratio: number | null;
}

export interface DownloadedYouTubeSource {
  filePath: string;
  fileName: string;
}

/** Loose check used by the UI: any well-formed http(s) URL. The backend reports anything it cannot import. */
export function isLooseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function getYouTubeImportVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("clipper_youtube_import_enabled").catch(() => null);
}

/** Removes partial downloads of an interrupted import. Finished videos are never deleted. */
export async function cleanYouTubeSources(projectId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("clean_clipper_youtube_sources", { projectId });
}

function reportYouTubeImportError(code: string, phase: string, version: string): void {
  Sentry.withScope((scope) => {
    scope.clear();
    scope.addEventProcessor((event) => {
      delete event.breadcrumbs;
      delete event.request;
      delete event.user;
      delete event.extra;
      return event;
    });
    Sentry.captureMessage("YouTube import failed", {
      level: "error",
      fingerprint: ["youtube-import", phase, code],
      tags: { import_code: code, import_phase: phase, extractor_version: version },
    });
  });
}

export async function downloadYouTubeSource(options: {
  projectId: string;
  version: string;
  url: string;
  rightsConfirmed: boolean;
  signal: AbortSignal;
  onProgress: (progress: YouTubeImportProgress) => void;
}): Promise<DownloadedYouTubeSource> {
  const { projectId, version, signal, onProgress } = options;
  if (!options.rightsConfirmed) throw new Error("Confirm that you have the rights to import this video.");
  if (!isLooseUrl(options.url)) throw new Error("Enter a valid link.");
  return withClipperProjectWrite(projectId, signal, async (projectSignal) => {
    try {
      const result = await runTauriNativeJob<YouTubeImportProgress, DownloadedYouTubeSource>({
        jobId: createTauriNativeJobId("youtube-import"),
        startCommand: "start_clipper_youtube_import",
        args: { projectId, url: options.url.trim(), rightsConfirmed: options.rightsConfirmed },
        signal: projectSignal,
        onProgress,
      });
      projectSignal.throwIfAborted();
      return result;
    } catch (error) {
      if (projectSignal.aborted || (error instanceof TauriNativeJobError && error.code === "cancelled")) {
        throw new DOMException("Import cancelled.", "AbortError");
      }
      if (error && typeof error === "object" && "code" in error && error.code === "invalid_link"
        && "message" in error && typeof error.message === "string") {
        throw new Error(error.message);
      }
      if (error instanceof TauriNativeJobError) {
        reportYouTubeImportError(error.code ?? "unknown", error.phase ?? "unknown", version);
        throw error;
      }
      reportYouTubeImportError("start_failed", "start", version);
      throw new Error("Could not start the YouTube import. Try again.");
    }
  });
}

export async function openDownloadedYouTubeSource(options: {
  projectId: string;
  version: string;
  downloaded: DownloadedYouTubeSource;
  signal: AbortSignal;
  onProgress: (progress: YouTubeImportProgress) => void;
  onSource: (file: File, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const { projectId, version, downloaded, signal, onProgress, onSource } = options;
  await withClipperProjectWrite(projectId, signal, async (projectSignal) => {
    try {
      projectSignal.throwIfAborted();
      onProgress({ phase: "prepare", ratio: null });
      await onSource(pathBackedFile(downloaded.filePath, downloaded.fileName), projectSignal);
    } catch (error) {
      if (projectSignal.aborted) {
        throw new DOMException("Import cancelled.", "AbortError");
      }
      reportYouTubeImportError("ingest_failed", "save", version);
      throw new Error("The video was saved to your Downloads folder, but it could not be opened for editing.");
    }
  });
}
