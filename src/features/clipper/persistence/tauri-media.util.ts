import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../shared/utils/platform.util";
import { getNativeFilePath } from "../platform/native-source.util";

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

  try {
    const result = await invoke<RegisteredMediaSource>("register_media_source", {
      path: sourcePath,
    });
    registeredMediaUrls.set(sourcePath, result.url);
    return result.url;
  } catch (error) {
    if (/Cannot resolve media path|Media path is not a file/i.test(String(error))) {
      throw new Error("Source video is missing or inaccessible. Restore the file to its original location, then reopen the project. Your prepared clips and transcript are preserved.", { cause: error });
    }
    const cached = registeredMediaUrls.get(sourcePath);
    if (cached) return cached;
    return fallbackUrl ?? convertFileSrc(sourcePath);
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
