export const CLIPPER_SETTINGS_DRAWER_PANELS = ["captions", "branding"] as const;

export type ClipperSettingsDrawerPanel = (typeof CLIPPER_SETTINGS_DRAWER_PANELS)[number];

export const CLIPPER_SETTINGS_DRAWER_CONTENT_ID = "clipper-settings-drawer";
