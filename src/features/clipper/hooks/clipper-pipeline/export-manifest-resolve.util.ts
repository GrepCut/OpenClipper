import {
  fetchClipperExports,
  type ClipperExportRecord,
} from "../../persistence/clipper-export-db-api.util";
import type { ClipperFormatResult } from "../../shared/state.util";

export function metadataFieldsFromExportRecord(
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

export async function fetchClipperExportRecords(projectId: string): Promise<ClipperExportRecord[]> {
  return fetchClipperExports(projectId).catch(() => [] as ClipperExportRecord[]);
}
