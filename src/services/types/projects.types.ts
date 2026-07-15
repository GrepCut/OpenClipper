import type { User } from "../../shared/types/auth.types";
import { StorageLocation } from '../../shared/types/storage.types';

export type ProjectType = "editor" | "clipper";

export interface ClipperPipelineSummary {
  completedSteps: number;
  totalSteps: number;
}

export interface ProjectTimelineSettings {
  id: string;
  projectId: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  currentTime: number;
  timelineZoom: number;
  aspectRatio: number;
}

export interface Video {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  duration?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  projectType?: ProjectType;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  user: User;
  videos: Video[];

  storageLocation: StorageLocation;
  localDirectoryPath?: string | null;

  googleDriveFolderId?: string;
  googleDriveFolderName?: string;
  googleDriveFolderUrl?: string;

  projectThumbnailBase64?: string | null;
  thumbnailTimestamp?: number | null;
  thumbnailManuallySet?: boolean;
  thumbnailLastUpdated?: string | null;

  thumbnailFormat?: string;
  timelineSettings?: ProjectTimelineSettings;
  clipperPipelineSummary?: ClipperPipelineSummary;
}

export interface ProjectsResponse {
  data: Project[];
  total: number;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  projectType?: ProjectType;
  metadata?: Record<string, unknown> | null;
  storageLocation?: StorageLocation;
  localDirectoryPath?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  width?: number;
  height?: number;
  fps?: number;
}
