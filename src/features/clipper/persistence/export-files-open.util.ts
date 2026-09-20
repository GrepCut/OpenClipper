import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../shared/utils/platform.util";
import { clipperWarn } from "../shared/logger.util";

export async function openClipperExportsDir(projectId: string): Promise<string | null> {
  if (isTauri()) {
    return invoke<string>("open_clipper_project_exports_dir", { projectId });
  }
  clipperWarn("export-files: open exports folder is only available in the desktop app");
  return null;
}

export async function revealClipperExportInFolder(
  projectId: string,
  fileName: string,
): Promise<string | null> {
  if (isTauri()) {
    return invoke<string>("reveal_clipper_export_in_folder", { projectId, fileName });
  }
  clipperWarn("export-files: reveal in folder is only available in the desktop app");
  return null;
}
