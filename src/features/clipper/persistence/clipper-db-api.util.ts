import {
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database.util";
import {
  DEFAULT_CLIPPER_SETTINGS,
  mergeClipperSettings,
  type ClipperSettings,
} from "../settings/settings.util";

const RENDER_QUEUE = "clipper-render-queue";
const SETTINGS = "clipper-settings";

export async function fetchRenderQueueFormats(
  projectId: string,
): Promise<Record<number, string[]>> {
  return (
    (await localRecordGet<Record<number, string[]>>(RENDER_QUEUE, projectId)) ??
    {}
  );
}

export async function saveRenderQueueFormats(
  projectId: string,
  selections: Record<number, string[]>,
): Promise<Record<number, string[]>> {
  return localRecordPut(RENDER_QUEUE, projectId, projectId, selections);
}

export async function fetchClipperProjectSettings(
  projectId: string,
): Promise<ClipperSettings> {
  const stored = await localRecordGet<Partial<ClipperSettings>>(
    SETTINGS,
    projectId,
  );
  return mergeClipperSettings(DEFAULT_CLIPPER_SETTINGS, stored ?? {});
}

export async function saveClipperProjectSettings(
  projectId: string,
  settings: ClipperSettings,
): Promise<ClipperSettings> {
  return localRecordPut(SETTINGS, projectId, projectId, settings);
}
