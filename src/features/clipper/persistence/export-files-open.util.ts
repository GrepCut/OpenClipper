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
