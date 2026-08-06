import { DEFAULT_CLIPPER_SETTINGS, mergeClipperSettings, type ClipperSettings } from "./settings.util";
import { parseStoredClipperSettings } from "../persistence/clipper-persistence-schemas.util";
import { migrateEnabledFormatIds } from "../shared/formats.util";

export const STORAGE_KEY = "clipper:settings:v2";
export const LAST_RENDER_QUEUE_FORMATS_KEY = "clipper:last-render-queue-formats:v1";

/** Loads clipper settings from localStorage, merging with defaults for missing fields. */
export function loadClipperSettings(): ClipperSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CLIPPER_SETTINGS;
    const parsed = parseStoredClipperSettings(JSON.parse(raw));
    const merged = mergeClipperSettings(
      DEFAULT_CLIPPER_SETTINGS,
      parsed as Partial<ClipperSettings> | undefined,
    );
    return {
      ...merged,
      formats: {
        ...merged.formats,
        enabledFormatIds: migrateEnabledFormatIds(merged.formats.enabledFormatIds),
      },
    };
  } catch {
    return DEFAULT_CLIPPER_SETTINGS;
  }
}

/** Persists clipper settings to localStorage. */
export function saveClipperSettings(settings: ClipperSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, quota) — settings just won't persist.
  }
}

/** Last render-queue format checklist — reused when opening a project with no saved queue. */
export function loadLastRenderQueueFormatIds(): string[] | null {
  try {
    const raw = localStorage.getItem(LAST_RENDER_QUEUE_FORMATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const migrated = migrateEnabledFormatIds(
      parsed.filter((id): id is string => typeof id === "string"),
    );
    return migrated.length > 0 ? migrated : null;
  } catch {
    return null;
  }
}

export function saveLastRenderQueueFormatIds(ids: string[]): void {
  try {
    localStorage.setItem(LAST_RENDER_QUEUE_FORMATS_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — preference just won't persist.
  }
}
