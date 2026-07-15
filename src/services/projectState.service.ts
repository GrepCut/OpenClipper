import {
  localRecordGet,
  localRecordPut,
} from "../shared/persistence/local-database";

export type TimelineMediaFileType = "video" | "audio" | "image";
export type TimelineStorageType = "filesystem" | "googleDrive";

export interface TimelineMediaFileMetadata {
  type?: string;
  resolution?: string;
  sourceNativePath?: string;
}

export interface TimelineMediaFile {
  id: string;
  fileType: TimelineMediaFileType;
  name: string;
  relativePath?: string | null;
  storageType: TimelineStorageType;
  libraryItemId?: string | null;
  duration?: number | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  metadata?: TimelineMediaFileMetadata | null;
}

export interface TimelineStateResponse {
  mediaFiles: TimelineMediaFile[];
}

export interface PatchTimelineStatePayload {
  mediaFiles?: {
    add?: Partial<TimelineMediaFile>[];
    update?: Partial<TimelineMediaFile>[];
    remove?: string[];
  };
}

const NAMESPACE = "project-state";

export const projectStateService = {
  loadState: async (projectId: string): Promise<TimelineStateResponse> =>
    (await localRecordGet<TimelineStateResponse>(NAMESPACE, projectId)) ?? {
      mediaFiles: [],
    },

  patchState: async (
    projectId: string,
    payload: PatchTimelineStatePayload,
  ): Promise<void> => {
    const state = (await localRecordGet<TimelineStateResponse>(
      NAMESPACE,
      projectId,
    )) ?? { mediaFiles: [] };
    const changes = payload.mediaFiles;
    if (!changes) return;

    const byId = new Map(state.mediaFiles.map((file) => [file.id, file]));
    for (const id of changes.remove ?? []) byId.delete(id);
    for (const candidate of changes.add ?? []) {
      if (!candidate.id) continue;
      byId.set(candidate.id, candidate as TimelineMediaFile);
    }
    for (const candidate of changes.update ?? []) {
      if (!candidate.id) continue;
      const current = byId.get(candidate.id);
      if (current) byId.set(candidate.id, { ...current, ...candidate });
    }

    await localRecordPut(NAMESPACE, projectId, projectId, {
      mediaFiles: [...byId.values()],
    });
  },
};
