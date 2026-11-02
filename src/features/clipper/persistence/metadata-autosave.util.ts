import { projectsService } from "../../../services/projects.service";
import {
  clipperMetadataToRecord,
  parseClipperProjectMetadata,
  type ClipperProjectMetadata,
} from "./project-metadata.util";
import { flushClipperProjectSettingsSave } from "./settings-autosave.util";
import { flushRenderQueueSave } from "./render-queue-autosave.util";
import { createDebouncedSaver } from "./create-debounced-saver.util";
import { reportClipperPersistenceError } from "./persistence-error.util";
import { flushPendingClipperExports } from "./clipper-export-persist.util";
import { isClipperProjectDeleted } from "./project-write-lifecycle.util";

interface MetadataSavePayload {
  projectId: string;
  metadata: ClipperProjectMetadata;
}

const metadataSaver = createDebouncedSaver<MetadataSavePayload>({
  debounceMs: 2000,
  key: ({ projectId }) => projectId,
  onError: reportClipperPersistenceError,
  flush: async ({ projectId, metadata }) => {
    await saveClipperProjectMetadata(projectId, metadata);
  },
});

export function getClipperMetadataFromProject(
  metadata: Record<string, unknown> | null | undefined,
): ClipperProjectMetadata {
  return parseClipperProjectMetadata(metadata);
}

export async function saveClipperProjectMetadata(
  projectId: string,
  metadata: ClipperProjectMetadata,
): Promise<void> {
  await projectsService.update(projectId, {
    metadata: clipperMetadataToRecord(metadata),
  });
}

export function scheduleClipperProjectMetadataSave(
  projectId: string,
  metadata: ClipperProjectMetadata,
): void {
  if (isClipperProjectDeleted(projectId)) return;
  metadataSaver.schedule({ projectId, metadata });
}

export function scheduleClipperProjectMetadataSaveImmediate(
  projectId: string,
  metadata: ClipperProjectMetadata,
): Promise<void> {
  if (isClipperProjectDeleted(projectId)) return Promise.resolve();
  return metadataSaver.scheduleImmediate({ projectId, metadata });
}

export async function flushClipperProjectMetadataSave(): Promise<void> {
  await metadataSaver.flush();
}

export const pauseClipperProjectMetadataSave = (projectId: string) => metadataSaver.pause(projectId);
export const resumeClipperProjectMetadataSave = (projectId: string) => metadataSaver.resume(projectId);
export const discardClipperProjectMetadataSave = (projectId: string) => metadataSaver.discard(projectId);

export async function flushClipperPersistence(): Promise<void> {
  const results = await Promise.allSettled([
    flushClipperProjectMetadataSave(),
    flushClipperProjectSettingsSave(),
    flushRenderQueueSave(),
    flushPendingClipperExports(),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

let flushListenersRegistered = false;
let tauriCloseInProgress = false;

async function registerTauriCloseFlush(): Promise<void> {
  try {
    const { isTauri } = await import("../../../shared/utils/platform.util");
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (tauriCloseInProgress) return;
      tauriCloseInProgress = true;
      try {
        await flushClipperPersistence();
        await win.destroy();
      } catch (error) {
        reportClipperPersistenceError(error);
      } finally {
        tauriCloseInProgress = false;
      }
    });
  } catch {
    // Window close hook is best-effort; persistence still flushes on unmount.
  }
}

/** Ensures pending metadata and settings writes flush when the tab closes or hides. */
export function registerClipperPersistenceFlushListeners(): void {
  if (flushListenersRegistered || typeof window === "undefined") return;
  flushListenersRegistered = true;

  const flush = () => {
    void flushClipperPersistence().catch(reportClipperPersistenceError);
  };

  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  void registerTauriCloseFlush();
}
