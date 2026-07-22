import { v4 as uuidv4 } from "uuid";
import {
  localProjectDelete,
  localProjectGet,
  localProjectList,
  localProjectPut,
  localRecordGet,
} from "../shared/persistence/local-database.util";
import { StorageLocation } from "../shared/types/storage.types";
import { LOCAL_WORKSPACE_OWNER_ID } from "../shared/persistence/local-workspace.util";
export * from "./types/projects.types";
import type {
  Project,
  ProjectsResponse,
  CreateProjectDto,
  UpdateProjectDto,
  ProjectType,
} from "./types/projects.types";

function ownerId(): string {
  return LOCAL_WORKSPACE_OWNER_ID;
}

export const projectsService = {
  getAll: async (
    page = 1,
    limit = 10,
    search = "",
    projectType?: ProjectType,
    sortBy?: "createdAt" | "updatedAt",
  ): Promise<ProjectsResponse> => {
    const response = await localProjectList<Project>({
      ownerId: ownerId(),
      page,
      limit,
      search,
      projectType,
      sortBy,
    });
    const summaryKeys = new Set([
      "confirm_range",
      "transcribe",
      "analyze_faces",
      "analyze_subjects",
      "preview_ready",
    ]);
    const data = await Promise.all(
      response.data.map(async (project) => {
        if (project.projectType !== "clipper") return project;
        const steps =
          (await localRecordGet<Array<{ stepKey: string; status: string }>>(
            "clipper-pipeline-steps",
            project.id,
          )) ?? [];
        const completedSteps = steps.filter(
          (step) =>
            summaryKeys.has(step.stepKey) && step.status === "completed",
        ).length;
        return {
          ...project,
          clipperPipelineSummary: {
            completedSteps,
            totalSteps: summaryKeys.size,
          },
        };
      }),
    );
    return { ...response, data };
  },

  getById: async (id: string): Promise<Project> => {
    const project = await localProjectGet<Project>(id, ownerId());
    if (!project) throw new Error(`Local project ${id} was not found.`);
    return project;
  },

  create: async (data: CreateProjectDto): Promise<Project> => {
    const now = new Date().toISOString();
    const project: Project = {
      id: uuidv4(),
      name: data.name,
      description: data.description ?? null,
      status: "draft",
      projectType: data.projectType ?? "clipper",
      metadata: data.metadata ?? null,
      createdAt: now,
      updatedAt: now,
      user: null,
      videos: [],
      storageLocation: data.storageLocation ?? StorageLocation.LOCAL,
      localDirectoryPath: data.localDirectoryPath ?? null,
    };
    return localProjectPut(ownerId(), project);
  },

  update: async (id: string, data: UpdateProjectDto): Promise<Project> => {
    const owner = ownerId();
    const project = await localProjectGet<Project>(id, owner);
    if (!project) throw new Error(`Local project ${id} was not found.`);
    const updated: Project = {
      ...project,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return localProjectPut(owner, updated);
  },

  delete: async (id: string): Promise<void> =>
    localProjectDelete(id, ownerId()),

  updateThumbnail: async (
    id: string,
    data: { thumbnailBase64: string; timestamp: number; isManual: boolean },
  ): Promise<Project> => {
    const owner = ownerId();
    const project = await localProjectGet<Project>(id, owner);
    if (!project) throw new Error(`Local project ${id} was not found.`);
    const updated: Project = {
      ...project,
      projectThumbnailBase64: data.thumbnailBase64,
      thumbnailTimestamp: data.timestamp,
      thumbnailManuallySet: data.isManual,
      thumbnailLastUpdated: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return localProjectPut(owner, updated);
  },
};
