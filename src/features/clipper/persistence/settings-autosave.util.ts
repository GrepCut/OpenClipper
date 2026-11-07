import type { ClipperSettings } from "../settings/settings.util";
import { saveClipperProjectSettings } from "./clipper-db-api.util";
import { createDebouncedSaver } from "./create-debounced-saver.util";
import { reportClipperPersistenceError } from "./persistence-error.util";
import { isClipperProjectDeleted } from "./project-write-lifecycle.util";

interface SettingsSavePayload {
  projectId: string;
  settings: ClipperSettings;
}

const settingsSaver = createDebouncedSaver<SettingsSavePayload>({
  debounceMs: 500,
  key: ({ projectId }) => projectId,
  onError: reportClipperPersistenceError,
  flush: async ({ projectId, settings }) => {
    await saveClipperProjectSettings(projectId, settings);
  },
});

export function scheduleClipperProjectSettingsSave(
  projectId: string,
  settings: ClipperSettings,
): void {
  if (isClipperProjectDeleted(projectId)) return;
  settingsSaver.schedule({ projectId, settings });
}

export async function flushClipperProjectSettingsSave(): Promise<void> {
  await settingsSaver.flush();
}

export const pauseClipperProjectSettingsSave = (projectId: string) => settingsSaver.pause(projectId);
export const resumeClipperProjectSettingsSave = (projectId: string) => settingsSaver.resume(projectId);
export const discardClipperProjectSettingsSave = (projectId: string) => settingsSaver.discard(projectId);
