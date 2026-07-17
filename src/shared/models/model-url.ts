import { asset } from "../utils/asset";
import { isTauriBuild } from "../utils/platform";

/**
 * Origin protokołu `grepcut-models` (Rust: src-tauri/src/model_cache.rs).
 * Serwuje assety modeli ML z cache w appData, pobierając brakujące pliki
 * z CDN przy pierwszym użyciu — dzięki temu modele nie są pakowane do
 * instalatora (build Tauri pomija `public/models`).
 */
const TAURI_MODELS_ORIGIN = "https://grepcut-models.localhost";
declare const __OPEN_CLIPPER_MODELS_CDN_BASE__: string;

export const MODELS_CDN_BASE = __OPEN_CLIPPER_MODELS_CDN_BASE__;

/**
 * Rozwiązuje ścieżkę assetu modelu ML (`/models/...`).
 *
 * - Dev (web i Tauri): lokalnie z `public/models/`.
 * - Web production: bezpośrednio z CDN Open Clipper.
 * - Tauri produkcja: przez `grepcut-models` (download-on-demand + cache).
 *
 * Uwaga: używa `isTauriBuild` (stała compile-time), nie `isTauri()` —
 * moduł jest importowany także w Web Workerach, gdzie nie ma `window`.
 */
export function modelAssetUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!import.meta.env.PROD) {
    return asset(p);
  }
  if (isTauriBuild && import.meta.env.PROD) {
    return `${TAURI_MODELS_ORIGIN}${p}`;
  }
  return `${MODELS_CDN_BASE}${p}`;
}
