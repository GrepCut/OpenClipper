import type { Project } from "../../../../services/projects.service";
import { syncClipperSourceVideo, type SyncClipperSourceVideoOptions } from "../../persistence/bootstrap.util";
import type { ClipperMediaFile } from "../../persistence/persistence.types";
import { releasePlayableMediaUrl, resolveFilePlayableUrl } from "../../persistence/tauri-media.util";
import { clipperLog, formatBytes } from "../../shared/logger.util";
import type { PipelineReporter } from "../reporter.util";
import type { ClipperSession } from "../session.util";

export interface IngestStageResult {
  session: ClipperSession;
  mediaFile: ClipperMediaFile;
}

/** Syncs source video to the project after validation passed in the hook. */
export async function runIngestStage(
  project: Project,
  file: File,
  token: string,
  reporter: PipelineReporter | undefined,
  options: Pick<SyncClipperSourceVideoOptions, "signal" | "mediaFileId" | "onRegister">,
): Promise<IngestStageResult> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  clipperLog(`pipeline[${runId}]: file selected`, {
    fileName: file.name,
    fileSize: formatBytes(file.size),
    fileType: file.type,
  });

  reporter?.stage("uploading", "Saving video to your project…");
  reporter?.stageProgress(0);

  // Resolved before anything is saved, so an unreadable file registers nothing.
  const sourceUrl = await resolveFilePlayableUrl(file);
  const mediaFile = await syncClipperSourceVideo(project, file, token, {
    ...options,
    playableUrl: sourceUrl,
    onProgress: (ratio) => reporter?.stageProgress(ratio),
  }).catch((error) => {
    releasePlayableMediaUrl(sourceUrl);
    throw error;
  });

  const session: ClipperSession = {
    sourceFile: file,
    sourceUrl,
    sourceDuration: mediaFile.duration,
    mediaFileId: mediaFile.id,
    rangeTrimmedFile: null,
    rangeTrimmedVideoUrl: null,
    rangeWords: [],
    words: [],
    audioEnvelope: null,
    rangeStart: 0,
    rangeEnd: 0,
    clipStart: 0,
    clipEnd: 0,
    autoPartsClips: [],
    aiClips: [],
    manualClips: [],
    clipSourceMode: "auto-parts",
    clips: [],
    activeClipIndex: 0,
    disabledCollageRegionIds: [],
    faceCache: null,
    captionGroupsCache: null,
    faceRenderCache: null,
  };

  return { session, mediaFile };
}
