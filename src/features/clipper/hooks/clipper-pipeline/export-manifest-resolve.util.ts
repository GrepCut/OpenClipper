import {
  fetchClipperExports,
  type ClipperExportRecord,
} from "../../persistence/clipper-export-db-api.util";
import type { ExportSocialFields } from "../../persistence/clipper-export-social.util";
import type { ClipperFormatResult } from "../../shared/state.util";

export function socialFieldsFromExportRecord(record: ClipperExportRecord): ExportSocialFields {
  return {
    socialTitle: record.socialTitle,
    socialDescription: record.socialDescription,
    socialHashtags: record.socialHashtags,
  };
}

export function metadataFieldsFromExportRecord(
  record: ClipperExportRecord,
): Pick<
  ClipperFormatResult,
  | "transcriptPlain"
  | "transcriptTimestamped"
  | "socialTitle"
  | "socialDescription"
  | "socialHashtags"
> {
  return {
    transcriptPlain: record.transcriptPlain,
    transcriptTimestamped: record.transcriptTimestamped,
    ...socialFieldsFromExportRecord(record),
  };
}

export async function fetchClipperExportRecords(projectId: string): Promise<ClipperExportRecord[]> {
  return fetchClipperExports(projectId).catch(() => [] as ClipperExportRecord[]);
}
