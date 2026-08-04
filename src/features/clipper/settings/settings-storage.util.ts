import { DEFAULT_CLIPPER_SETTINGS, mergeClipperSettings, type ClipperSettings } from "./settings.util";
import { parseStoredClipperSettings } from "../persistence/clipper-persistence-schemas.util";
import { migrateEnabledFormatIds } from "../shared/formats.util";

export const STORAGE_KEY = "clipper:settings:v2";

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
