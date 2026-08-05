import type { ClipperExportMapItem } from "./clipper-export-db-api.util";
import type { ClipperFormatResult } from "../shared/state.util";

export type ExportNodeStatus = "incomplete" | "ready" | "published";

export type ExportSocialFields = Pick<
  ClipperFormatResult,
  "socialTitle" | "socialDescription" | "socialHashtags"
>;

export type SocialPatchMode = "overwrite" | "fill_missing";

export const EXPORT_SOCIAL_FIELD_LABELS: Record<keyof ExportSocialFields, string> = {
  socialTitle: "Title",
  socialDescription: "Description",
  socialHashtags: "Hashtags",
};

export function socialFieldsFromResult(result: ClipperFormatResult): ExportSocialFields {
  return {
    socialTitle: result.socialTitle ?? "",
    socialDescription: result.socialDescription ?? "",
    socialHashtags: result.socialHashtags ?? "",
  };
}

export function countMissingSocialFields(result: ClipperFormatResult): number {
  const fields = socialFieldsFromResult(result);
  return Object.values(fields).filter((value) => !value?.trim()).length;
}

export function getExportNodeStatus(
  item: Pick<ClipperExportMapItem, "missingFields" | "isPublished">,
): ExportNodeStatus {
  if (item.isPublished) return "published";
  if (item.missingFields.length > 0) return "incomplete";
  return "ready";
}

export function getExportNodeStatusLabel(status: ExportNodeStatus): string {
  switch (status) {
    case "incomplete":
      return " · Missing metadata";
    case "ready":
      return " · Ready to publish";
    case "published":
      return " · Published";
  }
}

/** Human-readable labels for empty title / description / hashtags on a publish-map export. */
export function missingMetadataFieldLabels(missingFields: string[]): string[] {
  return missingFields
    .map((field) => {
      switch (field) {
        case "title":
          return "Title";
        case "description":
          return "Description";
        case "hashtags":
          return "Hashtags";
        default:
          return field;
      }
    })
    .filter(Boolean);
}

/** Prefer stdio for Cursor (avoids OAuth/mcp_auth gating on HTTP URL servers). */
export function buildMcpConfigSnippet(options: { httpUrl?: string; stdioPath?: string }): string {
  if (options.stdioPath) {
    return JSON.stringify(
      {
        mcpServers: {
          "open-clipper": {
            type: "stdio",
            command: options.stdioPath,
            args: [],
          },
        },
      },
      null,
      2,
    );
  }

  if (options.httpUrl) {
    return JSON.stringify(
      {
        mcpServers: {
          "open-clipper": {
            url: options.httpUrl,
          },
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      mcpServers: {
        "open-clipper": {
          type: "stdio",
          command: "open-clipper-mcp",
          args: [],
        },
      },
    },
    null,
    2,
  );
}
