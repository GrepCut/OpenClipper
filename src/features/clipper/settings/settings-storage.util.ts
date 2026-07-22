import { DEFAULT_CLIPPER_SETTINGS, mergeClipperSettings, type ClipperSettings } from "./settings.util";

export const STORAGE_KEY = "clipper:settings:v1";

/** Loads clipper settings from localStorage, merging with defaults for missing fields. */
export function loadClipperSettings(): ClipperSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CLIPPER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ClipperSettings>;
    return mergeClipperSettings(DEFAULT_CLIPPER_SETTINGS, parsed);
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
