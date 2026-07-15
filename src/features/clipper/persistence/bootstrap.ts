import { v4 as uuidv4 } from "uuid";
import { projectsService } from "../../../services/projects.service";
import type { Project } from "../../../services/projects.service";
import { isTauri } from "../../../shared/utils/platform";
import { readVideoDisplayDimensions } from "../lib/media/video-display-dims";
import { getPreciseVideoDuration } from "../lib/media/get-precise-video-duration";
import {
  isAbsoluteNativePath,
  resolveFilePlayableUrl,
  resolvePlayableMediaUrl,
} from "./tauri-media";
import {
  getLocalMediaSource,
  pathBackedMediaFile,
  rememberLocalMediaSource,
  resolveOrPromptLocalMediaSourceAsFile,
} from "./local-source";
import {
  createClipperMediaFile,
  getInMemorySourceFile,
  registerInMemorySourceFile,
  registerProjectDirectory,
} from "./project-sync";
import type { ClipperMediaFile } from "./types";
import { StorageLocation } from "./types";
import { clipperLog, clipperTimer, formatBytes } from "../shared/logger";
import {
  createDefaultClipperMetadata,
  createDefaultClipperProjectSettings,
  clipperMetadataToRecord,
} from "./project-metadata";
import { saveClipperProjectSettings } from "./clipper-db-api";
import { getNativeFilePath } from "../platform/native-source";
import { projectStateService } from "../../../services/projectState.service";
import type { TimelineMediaFile } from "../../../services/projectState.service";
import { registerClipperSourceMediaOnBackend } from "./register-source-media";

export interface CreateClipperProjectInput {
  name: string;
  description?: string;
  localDirectory?: FileSystemDirectoryHandle | null;
  token: string;
}

export interface SyncClipperSourceVideoResult {
  mediaFileId: string;
  duration: number;
  mediaFile: ClipperMediaFile;
}

export interface SyncClipperSourceVideoOptions {
  onProgress?: (ratio: number) => void;
}

export async function createClipperProject(
  input: CreateClipperProjectInput,
): Promise<Project> {
  const project = await projectsService.create({
    name: input.name.trim(),
    description: input.description?.trim() || "GrepCut Clipper project",
    projectType: "clipper",
    storageLocation: StorageLocation.LOCAL,
    localDirectoryPath: input.localDirectory?.name,
    width: 1920,
    height: 1080,
    fps: 30,
    metadata: clipperMetadataToRecord(createDefaultClipperMetadata()),
  });

  if (input.localDirectory) {
    await registerProjectDirectory(project.id, input.localDirectory);
  }

  void saveClipperProjectSettings(project.id, createDefaultClipperProjectSettings()).catch(() => {});

  return project;
}

export async function initClipperProjectSync(
  _project: Project,
  _token: string,
): Promise<void> {
  // ponytail: slim Tauri app — no editor sync service to initialize.
}

export async function syncClipperSourceVideo(
  project: Project,
  file: File,
  token: string,
  options: SyncClipperSourceVideoOptions = {},
): Promise<SyncClipperSourceVideoResult> {
  const report = (ratio: number) => {
    options.onProgress?.(Math.max(0, Math.min(1, ratio)));
  };

  clipperLog("sync source: begin", {
    fileName: file.name,
    fileSize: formatBytes(file.size),
    projectId: project.id,
  });

  report(0.02);
  await initClipperProjectSync(project, token);
  report(0.15);

  const nativePath = getNativeFilePath(file);
  const playableUrl = nativePath ? await resolveFilePlayableUrl(file) : undefined;

  const endDurationProbe = clipperTimer("sync source: probe duration");
  const durationPromise = getPreciseVideoDuration(file, playableUrl).then((duration) => {
    endDurationProbe();
    return duration;
  });

  const endDimsProbe = clipperTimer("sync source: probe dimensions");
  const dimensionsPromise = (playableUrl
    ? new Promise<{ width: number; height: number }>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () =>
          resolve({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => reject(new Error("Could not read native video dimensions."));
        video.src = playableUrl;
      })
    : readVideoDisplayDimensions(file)
  ).then((dimensions) => {
    endDimsProbe();
    return dimensions;
  });

  const [duration, dimensions] = await Promise.all([durationPromise, dimensionsPromise]);
  report(0.25);

  const mediaFileId = uuidv4();
  const useNativeReference =
    isTauri() && !!nativePath && isAbsoluteNativePath(nativePath);

  const mediaFile = createClipperMediaFile({
    id: mediaFileId,
    file,
    duration,
    width: dimensions.width,
    height: dimensions.height,
    nativePath: useNativeReference ? nativePath : null,
  });

  const endBackendRegister = clipperTimer("sync source: register on backend");
  await registerClipperSourceMediaOnBackend(project.id, token, mediaFile, file);
  endBackendRegister();
  report(0.95);

  if (useNativeReference && nativePath) {
    await rememberLocalMediaSource(mediaFileId, file.name, nativePath);
    report(1);
    clipperLog("sync source: complete (native reference)", {
      mediaFileId,
      sourceNativePath: nativePath,
      durationSec: duration,
    });
    return { mediaFileId, duration, mediaFile };
  }

  registerInMemorySourceFile(mediaFileId, file);
  report(1);
  clipperLog("sync source: complete", { mediaFileId, durationSec: duration });
  return { mediaFileId, duration, mediaFile };
}

async function resolveClipperSourceFile(
  mediaFile: ClipperMediaFile,
  onPhase?: LoadClipperSourceMediaFileOptions["onPhase"],
): Promise<File | null> {
  const sourceNativePath = mediaFile.sourcePath ?? null;

  if (isTauri() && sourceNativePath && isAbsoluteNativePath(sourceNativePath)) {
    await onPhase?.("Locating source video", "Using saved native path from project metadata");
    return pathBackedMediaFile(sourceNativePath, mediaFile.name);
  }

  const inMemory = getInMemorySourceFile(mediaFile.id);
  if (inMemory) return inMemory;

  if (isTauri()) {
    await onPhase?.("Locating source video", "Checking local media cache");
    const cached = await getLocalMediaSource(mediaFile.id);
    if (cached?.path) {
      return pathBackedMediaFile(cached.path, mediaFile.name);
    }
    await onPhase?.("Locating source video", "Prompting for source file");
    return resolveOrPromptLocalMediaSourceAsFile({
      id: mediaFile.id,
      name: mediaFile.name,
    });
  }

  return null;
}

function timelineMediaFileToClipperMediaFile(dbFile: TimelineMediaFile): ClipperMediaFile {
  const metadata = dbFile.metadata ?? {};
  const sourceNativePath =
    typeof metadata.sourceNativePath === "string" ? metadata.sourceNativePath : null;

  return {
    id: dbFile.id,
    name: dbFile.name,
    relativePath: dbFile.relativePath ?? dbFile.name,
    duration: dbFile.duration ?? 0,
    width: dbFile.width ?? 1920,
    height: dbFile.height ?? 1080,
    sourcePath: sourceNativePath,
    fileType: "video",
  };
}

function clipperMediaFileFromProjectMetadata(
  mediaFileId: string,
  metadata: Record<string, unknown> | undefined,
): ClipperMediaFile {
  return {
    id: mediaFileId,
    name:
      typeof metadata?.sourceFileName === "string"
        ? metadata.sourceFileName
        : "source.mp4",
    relativePath:
      typeof metadata?.sourceFileName === "string"
        ? metadata.sourceFileName
        : "source.mp4",
    duration: typeof metadata?.sourceDuration === "number" ? metadata.sourceDuration : 0,
    width: typeof metadata?.sourceWidth === "number" ? metadata.sourceWidth : 1920,
    height: typeof metadata?.sourceHeight === "number" ? metadata.sourceHeight : 1080,
    sourcePath:
      typeof metadata?.sourceNativePath === "string" ? metadata.sourceNativePath : null,
    fileType: "video",
  };
}

export interface LoadClipperSourceMediaFileOptions {
  onDownloadProgress?: (progress: { ratio: number; fileName?: string }) => void;
  onPhase?: (message: string, detail?: string) => void | Promise<void>;
}

export async function loadClipperSourceMediaFile(
  project: Project,
  token: string,
  sourceMediaFileId: string | null,
  options: LoadClipperSourceMediaFileOptions = {},
): Promise<{ mediaFile: ClipperMediaFile; file: File; sourceUrl: string } | null> {
  const metadata = project.metadata as Record<string, unknown> | undefined;
  const mediaFileId =
    sourceMediaFileId ??
    (typeof metadata?.sourceMediaFileId === "string" ? metadata.sourceMediaFileId : null);
  if (!mediaFileId) return null;

  await options.onPhase?.("Locating source video", "Loading project sync state from server");
  let mediaFile: ClipperMediaFile | null = null;

  try {
    const state = await projectStateService.loadState(project.id);
    const dbMediaFile =
      state.mediaFiles.find((mf) => mf.id === mediaFileId) ?? state.mediaFiles[0] ?? null;
    if (dbMediaFile) {
      mediaFile = timelineMediaFileToClipperMediaFile(dbMediaFile);
    }
  } catch (error) {
    clipperLog("sync source: backend state load failed, using project metadata fallback", {
      mediaFileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!mediaFile) {
    await options.onPhase?.("Locating source video", "Reading project metadata");
    mediaFile = clipperMediaFileFromProjectMetadata(mediaFileId, metadata);
  }

  const resolved = await resolveClipperSourceFile(mediaFile, options.onPhase);
  if (!resolved) return null;

  await options.onPhase?.("Locating source video", "Registering playable media URL");
  const filePath = getNativeFilePath(resolved) ?? mediaFile.sourcePath ?? null;
  const sourceUrl = filePath
    ? await resolvePlayableMediaUrl(filePath)
    : URL.createObjectURL(resolved);

  clipperLog("sync source: loaded clipper source", {
    mediaFileId: mediaFile.id,
    pathBacked: !!filePath,
    fileName: mediaFile.name,
  });

  return { mediaFile, file: resolved, sourceUrl };
}
