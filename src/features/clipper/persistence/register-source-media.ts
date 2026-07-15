import { projectStateService } from "../../../services/projectState.service";
import type { TimelineMediaFile } from "../../../services/projectState.service";
import type { ClipperMediaFile } from "./types";

function sanitizeRelativePath(pathStr: string): string {
  if (!pathStr) return "";
  if (/^[A-Za-z]:[/\\]/.test(pathStr) || pathStr.includes("\\")) {
    const parts = pathStr.split(/[/\\]/);
    return parts[parts.length - 1] ?? pathStr;
  }
  return pathStr.replace(/([.]{2,}\/)/g, "").replace(/^\/+/, "");
}

export function buildClipperSourceMediaPayload(
  mediaFile: ClipperMediaFile,
  file: File,
): Partial<TimelineMediaFile> {
  const nativePath = mediaFile.sourcePath;
  return {
    id: mediaFile.id,
    fileType: "video",
    name: mediaFile.name,
    relativePath: sanitizeRelativePath(mediaFile.relativePath || mediaFile.name),
    storageType: "filesystem",
    duration: mediaFile.duration,
    fileSizeBytes: file.size,
    width: mediaFile.width,
    height: mediaFile.height,
    metadata: {
      type: file.type || "video/mp4",
      resolution: `${mediaFile.width}x${mediaFile.height}`,
      ...(nativePath ? { sourceNativePath: nativePath } : {}),
    },
  };
}

export async function registerClipperSourceMediaOnBackend(
  projectId: string,
  _token: string,
  mediaFile: ClipperMediaFile,
  file: File,
): Promise<void> {
  const payload = buildClipperSourceMediaPayload(mediaFile, file);
  await projectStateService.patchState(projectId, {
    mediaFiles: { add: [payload] },
  });
}
