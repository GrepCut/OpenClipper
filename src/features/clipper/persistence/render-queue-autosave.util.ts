import { saveRenderQueueFormats } from "./clipper-db-api.util";
import { createDebouncedSaver } from "./create-debounced-saver.util";

interface RenderQueueSavePayload {
  projectId: string;
  selections: Record<number, string[]>;
}

const renderQueueSaver = createDebouncedSaver<RenderQueueSavePayload>({
  debounceMs: 500,
  flush: async ({ projectId, selections }) => {
    await saveRenderQueueFormats(projectId, selections);
  },
});

export function scheduleRenderQueueSave(
  projectId: string,
  selections: Record<number, string[]>,
): void {
  renderQueueSaver.schedule({ projectId, selections });
}

export async function flushRenderQueueSave(): Promise<void> {
  await renderQueueSaver.flush();
}
