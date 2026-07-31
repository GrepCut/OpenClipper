import { invoke } from "@tauri-apps/api/core";

export interface McpToolCatalogEntry {
  name: string;
  description?: string;
  inputExample: unknown;
  outputExample: unknown;
}

export interface McpToolsCatalog {
  instructions: string;
  tools: McpToolCatalogEntry[];
}

export async function fetchOpenClipperMcpToolsCatalog(): Promise<McpToolsCatalog> {
  return invoke<McpToolsCatalog>("get_open_clipper_mcp_tools_catalog");
}
