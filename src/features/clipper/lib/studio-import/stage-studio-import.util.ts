import { invoke } from "@tauri-apps/api/core";
import { CLIPPER_TRIMMED_SEGMENT_FILE } from "../../platform/native-source.util";
import type { ClipperStudioImportV1 } from "./clipper-studio-import.types";

/** Each browser tab keeps its own manifest, even for repeated imports of one clip. */
export async function stageManifestForStudioImport(
  projectId: string,
  manifest: ClipperStudioImportV1,
): Promise<ClipperStudioImportV1> {
  const fileName = `clipper-studio-import-${crypto.randomUUID().replaceAll("-", "")}.json`;
  const videoFileName = manifest.sourceVideoFileName || CLIPPER_TRIMMED_SEGMENT_FILE;
  const snapshot = { ...manifest, manifestFileName: fileName, sourceVideoFileName: videoFileName };
  const staged = await invoke<{
    projectDataDir: string;
    manifestAbsolutePath: string;
    videoAbsolutePath: string;
  }>("stage_clipper_studio_import", {
    projectId,
    manifestFileName: fileName,
    videoFileName,
    manifestContents: JSON.stringify(snapshot, null, 2),
  });

  const resolvedDataDir = staged.projectDataDir;
  if (/[/\\]studio-import[/\\]?$/i.test(resolvedDataDir.replace(/[/\\]+$/, ""))) {
    throw new Error(
      "Studio import resolved to obsolete studio-import staging. Restart Open Clipper so it uses Documents\\OpenClipper\\projects\\{id}\\data.",
    );
  }
  return {
    ...snapshot,
    projectDataDir: resolvedDataDir,
    manifestAbsolutePath: staged.manifestAbsolutePath || `${resolvedDataDir}\\${fileName}`,
    videoAbsolutePath: staged.videoAbsolutePath || `${resolvedDataDir}\\${videoFileName}`,
  };
}
