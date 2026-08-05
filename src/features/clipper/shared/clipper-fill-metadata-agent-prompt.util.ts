import type { ClipperSettings } from "../settings/settings.util";

/** Mirrors `.cursor/prompts/uzupelnij-metadane-klipey.md`. */
export const CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT = `Using the open-clipper MCP server, list all incomplete clip exports (\`list_exports\`, paginate with skip/rows until done). For each export, call \`get_export_details\`, read the transcript, and write title, description, and hashtags with \`patch_export_social_metadata\` (\`mode: "fill_missing"\`). Skip exports that already have all three fields filled.

Base every field on \`transcriptTimestamped\` only — same language as the clip, short hook title (~70 chars), 1–3 sentence description, 3–8 platform-appropriate hashtags. Report progress after each clip as [n/total] with exportId and what was filled. Continue on errors and summarize at the end.`;

/** @deprecated Use CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT */
export const CLIPPER_FILL_METADATA_AGENT_PROMPT = CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT;

export function getFillMetadataAgentPrompt(
  settings?: Pick<ClipperSettings, "publish">,
): string {
  const custom = settings?.publish?.fillMetadataAgentPrompt?.trim();
  return custom || CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT;
}

export function normalizeFillMetadataAgentPromptForStorage(draft: string): string {
  const trimmed = draft.trim();
  return trimmed === CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT ? "" : trimmed;
}
