import type { ClipperGeneratedClip } from "../engine/segmentation";
import { buildClipExportTranscript } from "./export-transcript.util";
import { upsertClipperExport, type ClipperExportRecord } from "./clipper-export-db-api.util";

export interface PersistClipperExportDiskMeta {
  id: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  exportedAt: string;
  clipStartSec: number;
  clipEndSec: number;
}

/** Single write path: upsert clipper_exports with transcript. Backend emits change events. */
export async function persistClipperExport(
  projectId: string,
  clip: ClipperGeneratedClip,
  diskMeta: PersistClipperExportDiskMeta,
): Promise<ClipperExportRecord> {
  const { transcriptPlain, transcriptTimestamped } = buildClipExportTranscript(clip);
  const record = await upsertClipperExport(projectId, {
    ...diskMeta,
    transcriptPlain,
    transcriptTimestamped,
  });
  return record;
}
