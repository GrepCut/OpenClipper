import { asset } from "../utils/asset";
import { isTauriBuild } from "../utils/platform";

/**
 * Origin protokołu `grepcut-models` (Rust: src-tauri/src/model_cache.rs).
 * Serwuje assety modeli ML z cache w appData, pobierając brakujące pliki
 * z CDN przy pierwszym użyciu — dzięki temu modele nie są pakowane do
 * instalatora (patrz scripts/prune-tauri-dist.mjs).
 */
const TAURI_MODELS_ORIGIN = "https://grepcut-models.localhost";

/**
 * Rozwiązuje ścieżkę assetu modelu ML (`/models/...`).
 *
 * - Web: jak `asset()` — pliki statyczne z `public/models/`.
 * - Tauri dev: również lokalnie (vite dev server ma pełne `public/`).
 * - Tauri produkcja: przez `grepcut-models` (download-on-demand + cache).
 *
 * Uwaga: używa `isTauriBuild` (stała compile-time), nie `isTauri()` —
 * moduł jest importowany także w Web Workerach, gdzie nie ma `window`.
 */
export function modelAssetUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isTauriBuild && import.meta.env.PROD) {
    return `${TAURI_MODELS_ORIGIN}${p}`;
  }
  return asset(p);
}
