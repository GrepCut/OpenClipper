/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_PLATFORM?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_CLIPPER_WINML_VISION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}
