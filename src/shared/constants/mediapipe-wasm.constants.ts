/**
 * Self-hosted MediaPipe vision WASM runtime.
 * Loader binaries live in `public/models/magic_touch/`.
 * `.tflite` model files use separate `asset()` paths — this is only the WASM runtime.
 */

import { modelAssetUrl } from "../models/model-url";

/** Public path segment for vision_wasm_internal.* — not for bare dynamic `import()`. */
const MEDIAPIPE_VISION_WASM_PUBLIC_SEGMENT =
  "/models/magic_touch";

/**
 * Absolute base URL for `FilesetResolver.forVisionTasks(...)`.
 * MediaPipe appends `/vision_wasm_internal.js` (or nosimd/module variants).
 * Must be absolute so workers can dynamic-import WASM from `/public`
 * with a vite-ignore hint.
 * In Tauri production this resolves to the `grepcut-models` origin
 * (download-on-demand cache) — already absolute.
 */
export function getMediapipeWasmBaseUrl(): string {
  const resolved = modelAssetUrl(MEDIAPIPE_VISION_WASM_PUBLIC_SEGMENT);
  if (/^https?:/i.test(resolved)) {
    return resolved.replace(/\/$/, "");
  }
  // `resolved` zaczyna się od "/" (asset() zachowuje prefiks bazowy), więc
  // new URL rozwiązuje względem originu — tak jak dotychczasowa implementacja.
  return new URL(resolved, globalThis.location.href).href.replace(/\/$/, "");
}
