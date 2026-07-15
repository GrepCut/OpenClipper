import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../shared/utils/platform";
import { getNativeFilePath } from "../platform/native-source";

interface RegisteredMediaSource {
  url: string;
}

const registeredMediaUrls = new Map<string, string>();
const ownedObjectUrls = new Set<string>();

export const isAbsoluteNativePath = (path: string): boolean =>
  /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("/");

export const resolvePlayableMediaUrl = async (
  sourcePath: string | null | undefined,
  fallbackUrl?: string,
): Promise<string> => {
  if (!sourcePath || !isTauri() || !isAbsoluteNativePath(sourcePath)) {
    return fallbackUrl ?? "";
  }

  const cached = registeredMediaUrls.get(sourcePath);
  if (cached) return cached;

  const assetUrl = convertFileSrc(sourcePath);
  if (assetUrl.startsWith("https:")) {
    registeredMediaUrls.set(sourcePath, assetUrl);
    return assetUrl;
  }

  try {
    const result = await invoke<RegisteredMediaSource>("register_media_source", {
      path: sourcePath,
    });
    registeredMediaUrls.set(sourcePath, result.url);
    return result.url;
  } catch {
    const fallback = convertFileSrc(sourcePath);
    registeredMediaUrls.set(sourcePath, fallback);
    return fallback;
  }
};

export const resolveFilePlayableUrl = async (file: File): Promise<string> => {
  const filePath = getNativeFilePath(file);
  if (filePath && isTauri()) {
    return resolvePlayableMediaUrl(filePath);
  }
  const url = URL.createObjectURL(file);
  ownedObjectUrls.add(url);
  return url;
};

export const releasePlayableMediaUrl = (url: string | null | undefined): void => {
  if (!url || !ownedObjectUrls.delete(url)) return;
  URL.revokeObjectURL(url);
};
