import type { ClipperSettings } from "../settings/settings";
import { saveClipperProjectSettings } from "./clipper-db-api";
import { createDebouncedSaver } from "./create-debounced-saver";

interface SettingsSavePayload {
  projectId: string;
  settings: ClipperSettings;
}

const settingsSaver = createDebouncedSaver<SettingsSavePayload>({
  debounceMs: 500,
  flush: async ({ projectId, settings }) => {
    await saveClipperProjectSettings(projectId, settings);
  },
});

export function scheduleClipperProjectSettingsSave(
  projectId: string,
  settings: ClipperSettings,
): void {
  settingsSaver.schedule({ projectId, settings });
}

export async function flushClipperProjectSettingsSave(): Promise<void> {
  await settingsSaver.flush();
}
