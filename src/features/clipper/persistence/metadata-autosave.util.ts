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
): void {
  metadataSaver.scheduleImmediate({ projectId, metadata });
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
}
