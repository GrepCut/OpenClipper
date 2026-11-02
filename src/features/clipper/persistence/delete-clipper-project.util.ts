import { projectsService } from "../../../services/projects.service";
import { removeClipperProjectDataDir } from "./project-data-files.util";
import { discardPendingClipperExports, settlePendingClipperExports } from "./clipper-export-persist.util";
import {
  discardClipperProjectMetadataSave, pauseClipperProjectMetadataSave, resumeClipperProjectMetadataSave,
} from "./metadata-autosave.util";
import {
  discardClipperProjectSettingsSave, pauseClipperProjectSettingsSave, resumeClipperProjectSettingsSave,
} from "./settings-autosave.util";
import { discardRenderQueueSave, pauseRenderQueueSave, resumeRenderQueueSave } from "./render-queue-autosave.util";
import {
  markClipperProjectDeleted, pauseClipperProjectRenders, resumeClipperProjectRenders,
} from "./project-write-lifecycle.util";

export async function deleteClipperProject(projectId: string): Promise<void> {
  const renders = pauseClipperProjectRenders(projectId);
  try {
    await Promise.all([
      renders,
      pauseClipperProjectMetadataSave(projectId),
      pauseClipperProjectSettingsSave(projectId),
      pauseRenderQueueSave(projectId),
      settlePendingClipperExports(projectId),
    ]);
    await removeClipperProjectDataDir(projectId);
    await projectsService.delete(projectId);
    markClipperProjectDeleted(projectId);
    await Promise.all([
      discardClipperProjectMetadataSave(projectId),
      discardClipperProjectSettingsSave(projectId),
      discardRenderQueueSave(projectId),
    ]);
    discardPendingClipperExports(projectId);
  } catch (error) {
    resumeClipperProjectRenders(projectId);
    resumeClipperProjectMetadataSave(projectId);
    resumeClipperProjectSettingsSave(projectId);
    resumeRenderQueueSave(projectId);
    throw error;
  }
}
