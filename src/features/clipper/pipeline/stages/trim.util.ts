import { isTauri } from "../../../../shared/utils/platform.util";
import { resolveFilePlayableUrl } from "../../persistence/tauri-media.util";
import {
  extractSegmentBuffer,
  getNativeFilePath,
  isNativeBacked,
} from "../../platform/native-source.util";
import { clipperLog, clipperWarn } from "../../shared/logger.util";
import {
  extractClipperSegmentToProjectData,
  readClipperTrimmedSegment,
  writeClipperTrimmedSegment,
} from "../../persistence/project-data-files.util";
import type { PipelineReporter } from "../reporter.util";
import type { ClipperSession } from "../session.util";

export interface TrimStageInput {
  projectId: string;
  snappedStart: number;
  end: number;
  skipTrim: boolean;
}

export interface TrimStageResult {
  trimmedFile: File;
  trimmedVideoUrl: string;
}

/** Trims or restores the clip segment for preview/render. */
export async function runTrimStage(
  session: ClipperSession,
  input: TrimStageInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<TrimStageResult> {
  const { projectId, snappedStart, end, skipTrim } = input;
  const trimMessage = skipTrim
    ? "Restoring trimmed video from project data…"
    : "Trimming clip…";
  reporter.stage("uploading", trimMessage);
  reporter.stageProgress(0);

  let trimmedFile: File;
  let trimmedVideoUrl: string;

  if (session.trimmedFile) {
    const existingPath = getNativeFilePath(session.trimmedFile);
    if (existingPath) {
      trimmedFile = session.trimmedFile;
      trimmedVideoUrl =
        session.trimmedVideoUrl ?? (await resolveFilePlayableUrl(trimmedFile));
    } else {
      const trimmedBuffer = await session.trimmedFile.arrayBuffer();
      trimmedFile = new File([trimmedBuffer], "clip-trimmed.mp4", { type: "video/mp4" });
      trimmedVideoUrl = URL.createObjectURL(trimmedFile);
    }
  } else if (skipTrim) {
    const restored = await readClipperTrimmedSegment(projectId, snappedStart, end);
    if (restored) {
      clipperLog("trim: restored trimmed segment from disk");
      trimmedFile = restored.file;
      trimmedVideoUrl = restored.videoUrl;
    } else {
      clipperWarn("trim: blob missing — rebuilding");
      reporter.stage("uploading", "Rebuilding clip…");
      const trimmed = await trimClipSegment(session, projectId, snappedStart, end, reporter, options);
      trimmedFile = trimmed.trimmedFile;
      trimmedVideoUrl = trimmed.trimmedVideoUrl;
    }
  } else {
    const trimmed = await trimClipSegment(session, projectId, snappedStart, end, reporter, options);
    trimmedFile = trimmed.trimmedFile;
    trimmedVideoUrl = trimmed.trimmedVideoUrl;
  }

  return { trimmedFile, trimmedVideoUrl };
}

async function trimClipSegment(
  session: ClipperSession,
  projectId: string,
  snappedStart: number,
  end: number,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<TrimStageResult> {
  const nativePath = getNativeFilePath(session.sourceFile);
  if (nativePath && isTauri()) {
    clipperLog("trim: using native Tauri FFmpeg packet copy (disk)", {
      startSec: snappedStart,
      endSec: end,
    });
    reporter.stageProgress(0.1);
    const restored = await extractClipperSegmentToProjectData(
      projectId,
      nativePath,
      snappedStart,
      end,
    );
    if (options.signal.aborted) throw new DOMException("Conversion aborted", "AbortError");
    reporter.stageProgress(1);
    return { trimmedFile: restored.file, trimmedVideoUrl: restored.videoUrl };
  }

  const trimmedBuffer = await extractSegmentBuffer(session.sourceFile, snappedStart, end, {
    signal: options.signal,
    onProgress: (ratio) => reporter.stageProgress(ratio),
  });
  const trimmedFile = new File([trimmedBuffer], "clip-trimmed.mp4", { type: "video/mp4" });
  const trimmedVideoUrl = URL.createObjectURL(trimmedFile);
  if (isTauri()) {
    await writeClipperTrimmedSegment(projectId, trimmedBuffer, {
      clipStart: snappedStart,
      clipEnd: end,
    });
  }
  return { trimmedFile, trimmedVideoUrl };
}

/** Native path-backed source: remux selected range once before transcription. */
export async function trimNativeSourceEarly(
  session: ClipperSession,
  projectId: string,
  snappedStart: number,
  end: number,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<void> {
  if (!isNativeBacked(session.sourceFile)) return;
  const trimmed = await trimClipSegment(session, projectId, snappedStart, end, reporter, options);
  session.rangeTrimmedFile = trimmed.trimmedFile;
  session.rangeTrimmedVideoUrl = trimmed.trimmedVideoUrl;
  session.trimmedFile = trimmed.trimmedFile;
  session.trimmedVideoUrl = trimmed.trimmedVideoUrl;
}
