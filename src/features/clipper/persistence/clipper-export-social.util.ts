import type { ClipperFormatResult } from "../shared/state.util";

export type ExportSocialFields = Pick<
  ClipperFormatResult,
  | "socialTitle"
  | "socialShortDescription"
  | "socialDescription"
  | "socialDescriptionTimestamped"
  | "socialHashtags"
>;

export type SocialPatchMode = "overwrite" | "fill_missing";

export const EXPORT_SOCIAL_FIELD_LABELS: Record<keyof ExportSocialFields, string> = {
  socialTitle: "Title",
  socialShortDescription: "Short description",
  socialDescription: "Description",
  socialDescriptionTimestamped: "Description with timestamps",
  socialHashtags: "Hashtags",
};

export function socialFieldsFromResult(result: ClipperFormatResult): ExportSocialFields {
  return {
    socialTitle: result.socialTitle ?? "",
    socialShortDescription: result.socialShortDescription ?? "",
    socialDescription: result.socialDescription ?? "",
    socialDescriptionTimestamped: result.socialDescriptionTimestamped ?? "",
    socialHashtags: result.socialHashtags ?? "",
  };
}

export function countMissingSocialFields(result: ClipperFormatResult): number {
  const fields = socialFieldsFromResult(result);
  return Object.values(fields).filter((value) => !value?.trim()).length;
}

export function buildMcpConfigSnippet(options: { httpUrl?: string; stdioPath?: string }): string {
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

  const command = options.stdioPath ?? "open-clipper-mcp";
  return JSON.stringify(
    {
      mcpServers: {
        "open-clipper": {
          command,
          args: [],
        },
      },
    },
    null,
    2,
  );
}
