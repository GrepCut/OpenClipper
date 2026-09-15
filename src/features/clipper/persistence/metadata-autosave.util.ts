import { projectsService } from "../../../services/projects.service";
import {
  clipperMetadataToRecord,
  parseClipperProjectMetadata,
  type ClipperProjectMetadata,
} from "./project-metadata.util";
import { flushClipperProjectSettingsSave } from "./settings-autosave.util";
import { flushRenderQueueSave } from "./render-queue-autosave.util";
import { createDebouncedSaver } from "./create-debounced-saver.util";

interface MetadataSavePayload {
  projectId: string;
  metadata: ClipperProjectMetadata;
}

const metadataSaver = createDebouncedSaver<MetadataSavePayload>({
  debounceMs: 2000,
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
  metadataSaver.schedule({ projectId, metadata });
}

export function scheduleClipperProjectMetadataSaveImmediate(
  projectId: string,
  metadata: ClipperProjectMetadata,
): Promise<void> {
  return metadataSaver.scheduleImmediate({ projectId, metadata });
}

export async function flushClipperProjectMetadataSave(): Promise<void> {
  await metadataSaver.flush();
}

export async function flushClipperPersistence(): Promise<void> {
  await Promise.all([
    flushClipperProjectMetadataSave(),
    flushClipperProjectSettingsSave(),
    flushRenderQueueSave(),
  ]);
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
      if (tauriCloseInProgress) return;
      event.preventDefault();
      tauriCloseInProgress = true;
      try {
        await flushClipperPersistence();
      } finally {
        await win.destroy();
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
    void flushClipperPersistence();
  };

  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  void registerTauriCloseFlush();
}
