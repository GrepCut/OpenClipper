import { saveRenderQueueFormats } from "./clipper-db-api.util";
import { createDebouncedSaver } from "./create-debounced-saver.util";
import { reportClipperPersistenceError } from "./persistence-error.util";
import { isClipperProjectDeleted } from "./project-write-lifecycle.util";

interface RenderQueueSavePayload {
  projectId: string;
  selections: Record<number, string[]>;
}

const renderQueueSaver = createDebouncedSaver<RenderQueueSavePayload>({
  debounceMs: 500,
  key: ({ projectId }) => projectId,
  onError: reportClipperPersistenceError,
  flush: async ({ projectId, selections }) => {
    await saveRenderQueueFormats(projectId, selections);
  },
});

export function scheduleRenderQueueSave(
  projectId: string,
  selections: Record<number, string[]>,
): void {
  if (isClipperProjectDeleted(projectId)) return;
  renderQueueSaver.schedule({ projectId, selections });
}

export async function flushRenderQueueSave(): Promise<void> {
  await renderQueueSaver.flush();
}

export const pauseRenderQueueSave = (projectId: string) => renderQueueSaver.pause(projectId);
export const resumeRenderQueueSave = (projectId: string) => renderQueueSaver.resume(projectId);
export const discardRenderQueueSave = (projectId: string) => renderQueueSaver.discard(projectId);
