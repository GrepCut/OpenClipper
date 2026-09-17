import { CLIPPER_FORMAT_DEFS, type ClipperFormatDef } from "../../shared/formats.util";
import type { ClipperFormatResult } from "../../shared/state.util";
import { resolveClipperOutputSize } from "../../engine/render/frame-draw.util";
import { renderClipperFormat, type ClipperClipWindow } from "../../engine/render/index";
import type { ClipperFrameContext } from "../../engine/render/index";
import { isTauri } from "../../../../shared/utils/platform.util";
import { clipperTimer } from "../../shared/logger.util";
import type { PipelineReporter } from "../reporter.util";
import type { ClipperSession } from "../session.util";
import { findClipByIndex, type ClipperGeneratedClip } from "../../engine/segmentation";
import {
  buildClipperExportFileName,
  createClipperExportId,
  createClipperExportSink,
} from "../../persistence/export-files.util";
import { persistClipperExport } from "../../persistence/clipper-export-persist.util";
import type { ClipperExportRecord } from "../../persistence/clipper-export-db-api.util";
import { renderProgressKey } from "../../shared/render-progress.util";

export interface RenderStageInput {
  projectId: string;
  enabledFormatIds: string[];
}

export interface RenderClipJobInput {
  projectId: string;
  clipIndex: number;
  enabledFormatIds: string[];
  filenameStem: string;
  filenameTemplate: string;
  /** Render-input fingerprint stored with each export (see render-signature.util). */
  renderSignature?: string;
}

function trackPreviewUrl(previewUrl: string, previewUrls: string[]): void {
  if (previewUrl.startsWith("blob:")) {
    previewUrls.push(previewUrl);
  }
}

function metadataFromRecord(
  record: ClipperExportRecord,
): Pick<
  ClipperFormatResult,
  | "transcriptPlain"
  | "transcriptTimestamped"
  | "socialTitle"
  | "socialShortDescription"
  | "socialDescription"
  | "socialDescriptionTimestamped"
  | "socialHashtags"
> {
  return {
    transcriptPlain: record.transcriptPlain,
    transcriptTimestamped: record.transcriptTimestamped,
    socialTitle: record.socialTitle,
    socialShortDescription: record.socialShortDescription,
    socialDescription: record.socialDescription,
    socialDescriptionTimestamped: record.socialDescriptionTimestamped,
    socialHashtags: record.socialHashtags,
  };
}

async function renderFormatToResult(
  rangeFile: File,
  formatDef: ClipperFormatDef,
  frameContext: ClipperFrameContext,
  clipWindow: ClipperClipWindow,
  clip: ClipperGeneratedClip,
  /** Overall envelope (min start, max end) across clipWindow.segments — for display/manifest metadata only. */
  envelope: { startSec: number; endSec: number },
  input: {
    projectId: string;
    clipIndex: number;
    filenameStem: string;
    filenameTemplate: string;
    renderSignature?: string;
  },
  options: { signal: AbortSignal; onProgress: (ratio: number) => void },
  previewUrls: string[],
): Promise<ClipperFormatResult> {
  const exportedAt = new Date();
  const exportId = createClipperExportId();
  const fileName = buildClipperExportFileName(
    input.filenameTemplate,
    input.filenameStem,
    formatDef.id,
    input.clipIndex,
    exportedAt,
  );
  const sink = await createClipperExportSink(input.projectId, fileName);

  try {
    const encodeResult = await renderClipperFormat(rangeFile, formatDef, frameContext, {
      signal: options.signal,
      clipWindow,
      outputSink: sink?.writable,
      onProgress: options.onProgress,
    });

    const { width, height } = resolveClipperOutputSize(
      formatDef,
      frameContext.settings.formats.resolutionCap,
    );

    if (encodeResult.kind === "disk-encoded" && sink) {
      const disk = await sink.finalize();
      trackPreviewUrl(disk.previewUrl, previewUrls);
      const exportedAtIso = exportedAt.toISOString();
      const dbRecord = await persistClipperExport(input.projectId, clip, {
        id: exportId,
        clipIndex: input.clipIndex,
        formatId: formatDef.id,
        fileName: sink.fileName,
        relativePath: disk.relativePath,
        width,
        height,
        fileSize: disk.fileSize,
        exportedAt: exportedAtIso,
        clipStartSec: envelope.startSec,
        clipEndSec: envelope.endSec,
        renderSignature: input.renderSignature,
      });
      return {
        id: exportId,
        formatId: formatDef.id,
        platform: formatDef.platform,
        label: formatDef.label,
        width,
        height,
        fileSize: disk.fileSize,
        previewUrl: disk.previewUrl,
        clipIndex: input.clipIndex,
        exportedAt: exportedAtIso,
        clipStartSec: envelope.startSec,
        clipEndSec: envelope.endSec,
        relativePath: disk.relativePath,
        renderSignature: input.renderSignature,
        displayPath: disk.displayPath,
        filePath: disk.filePath,
        file: disk.file,
        ...metadataFromRecord(dbRecord),
      };
    }

    if (encodeResult.kind !== "memory") {
      throw new Error("Disk export sink was unavailable.");
    }

    if (isTauri()) {
      throw new Error(
        "Disk export sink was unavailable. Export was not saved, check storage permissions and retry.",
      );
    }

    const previewUrl = URL.createObjectURL(encodeResult.blob);
    trackPreviewUrl(previewUrl, previewUrls);
    const exportedAtIso = exportedAt.toISOString();
    return {
      id: exportId,
      formatId: formatDef.id,
      platform: formatDef.platform,
      label: formatDef.label,
      width,
      height,
      fileSize: encodeResult.blob.size,
      previewUrl,
      clipIndex: input.clipIndex,
      exportedAt: exportedAtIso,
      clipStartSec: envelope.startSec,
      clipEndSec: envelope.endSec,
      renderSignature: input.renderSignature,
      blob: encodeResult.blob,
    };
  } catch (error) {
    if (sink) {
      await sink.abort().catch(() => {});
    }
    throw error;
  }
}

export interface RenderClipJobOutcome {
  /** Formats that finished (already written to disk / DB), even when a sibling format failed. */
  results: ClipperFormatResult[];
  /** First non-abort failure among the formats, or null. */
  error: unknown;
}

/** Renders all enabled export formats for one generated clip (windowed from range file). */
export async function runRenderClipJob(
  session: ClipperSession,
  frameContext: ClipperFrameContext,
  input: RenderClipJobInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal; previewUrls?: string[] },
): Promise<RenderClipJobOutcome> {
  const clip = findClipByIndex(session.clips, input.clipIndex);
  if (!clip) throw new Error(`Clip ${input.clipIndex} not found.`);

  const rangeFile = session.rangeTrimmedFile;
  if (!rangeFile) throw new Error("Range video is not ready, cannot render.");

  const formats = CLIPPER_FORMAT_DEFS.filter((f) => input.enabledFormatIds.includes(f.id));
  if (formats.length === 0) {
    throw new Error("Select at least one export format.");
  }

  const runId = `render-clip-${input.clipIndex}-${Date.now()}`;
  const endRun = clipperTimer(`pipeline[${runId}]: render clip ${input.clipIndex}`);
  const previewUrls = options.previewUrls ?? [];

  const clipWindow: ClipperClipWindow = { segments: clip.segments };
  const envelope = { startSec: clip.startSec, endSec: clip.endSec };

  const settled = await Promise.allSettled(
    formats.map(async (formatDef): Promise<ClipperFormatResult> => {
      const progressKey = renderProgressKey(input.clipIndex, formatDef.id);
      const endFormat = clipperTimer(`pipeline[${runId}]: render ${formatDef.id}`);
      const result = await renderFormatToResult(
        rangeFile,
        formatDef,
        frameContext,
        clipWindow,
        clip,
        envelope,
        input,
        {
          signal: options.signal,
          onProgress: (ratio) => reporter.renderProgress(progressKey, ratio),
        },
        previewUrls,
      );
      endFormat();
      return result;
    }),
  );

  const results: ClipperFormatResult[] = [];
  let error: unknown = null;
  for (const item of settled) {
    if (item.status === "fulfilled") {
      results.push(item.value);
    } else if (!options.signal.aborted) {
      error ??= item.reason;
    }
  }

  endRun();
  return { results, error };
}
