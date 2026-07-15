import type { Project } from "../../../../services/projects.service";
import { syncClipperSourceVideo } from "../../persistence/bootstrap";
import { resolveFilePlayableUrl } from "../../persistence/tauri-media";
import { clipperLog, formatBytes } from "../../shared/logger";
import type { PipelineReporter } from "../reporter";
import type { ClipperSession } from "../session";

export interface IngestStageResult {
  session: ClipperSession;
  mediaFileId: string;
  duration: number;
}

/** Syncs source video to the project after validation passed in the hook. */
export async function runIngestStage(
  project: Project,
  file: File,
  token: string,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<IngestStageResult> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  clipperLog(`pipeline[${runId}]: file selected`, {
    fileName: file.name,
    fileSize: formatBytes(file.size),
    fileType: file.type,
  });

  reporter.stage("uploading", "Saving video to your project…");
  reporter.stageProgress(0);

  const synced = await syncClipperSourceVideo(project, file, token, {
    onProgress: (ratio) => reporter.stageProgress(ratio),
  });
  if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");

  const sourceUrl = await resolveFilePlayableUrl(file);
  const session: ClipperSession = {
    sourceFile: file,
    sourceUrl,
    sourceDuration: synced.duration,
    mediaFileId: synced.mediaFileId,
    rangeTrimmedFile: null,
    rangeTrimmedVideoUrl: null,
    trimmedFile: null,
    trimmedVideoUrl: null,
    rangeWords: [],
    words: [],
    audioEnvelope: null,
    rangeStart: 0,
    rangeEnd: 0,
    clipStart: 0,
    clipEnd: 0,
    autoPartsClips: [],
    aiClips: [],
    clipSourceMode: "auto-parts",
    clips: [],
    activeClipIndex: 0,
    disabledCollageRegionIds: [],
    faceCache: null,
    captionGroupsCache: null,
    faceRenderCache: null,
  };

  return { session, mediaFileId: synced.mediaFileId, duration: synced.duration };
}
