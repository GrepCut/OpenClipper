import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../../../shared/utils/platform.util";

const isAbsoluteNativePath = (path: string): boolean =>
  /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("/");

interface BrandingLogoCacheEntry {
  path: string;
  /** `null` when the file could not be loaded. */
  image: ImageBitmap | null;
}

let cache: BrandingLogoCacheEntry | null = null;
let inflight: { path: string; promise: Promise<ImageBitmap | null> } | null = null;
const listeners = new Set<() => void>();

function resolveLogoUrl(path: string): string {
  if (path.startsWith("blob:") || path.startsWith("data:") || path.startsWith("http")) {
    return path;
  }
  if (isTauri() && isAbsoluteNativePath(path)) {
    return convertFileSrc(path);
  }
  return path;
}

async function loadBrandingLogo(path: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(resolveLogoUrl(path));
    if (!response.ok) return null;
    const blob = await response.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Notifies after a logo finishes loading, so every consumer (preview, settings) can refresh. */
export function subscribeBrandingLogo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBrandingLogo(path: string | null): ImageBitmap | null {
  if (!path || cache?.path !== path) return null;
  return cache.image;
}

export function isBrandingLogoMissing(path: string | null): boolean {
  return path != null && cache?.path === path && cache.image == null;
}

export function ensureBrandingLogo(path: string): Promise<ImageBitmap | null> {
  if (cache?.path === path) {
    return Promise.resolve(cache.image);
  }
  if (inflight?.path === path) {
    return inflight.promise;
  }

  const promise = loadBrandingLogo(path).then((image) => {
    if (inflight?.path !== path) {
      image?.close();
      return getBrandingLogo(path);
    }
    cache?.image?.close();
    cache = { path, image };
    inflight = null;
    for (const listener of listeners) listener();
    return image;
  });
  inflight = { path, promise };
  return promise;
}
