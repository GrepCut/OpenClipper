import { invoke } from "@tauri-apps/api/core";

export interface ClipperExportRecord {
  id: string;
  projectId: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  clipStartSec?: number;
  clipEndSec?: number;
  exportedAt: string;
  transcriptPlain: string;
  transcriptTimestamped: string;
  socialTitle: string;
  socialShortDescription: string;
  socialDescription: string;
  socialDescriptionTimestamped: string;
  socialHashtags: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertClipperExportInput {
  id: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  exportedAt: string;
  clipStartSec?: number;
  clipEndSec?: number;
  transcriptPlain?: string;
  transcriptTimestamped?: string;
  socialTitle?: string;
  socialShortDescription?: string;
  socialDescription?: string;
  socialDescriptionTimestamped?: string;
  socialHashtags?: string;
}

export interface ClipperExportSocialPatch {
  socialTitle?: string;
  socialShortDescription?: string;
  socialDescription?: string;
  socialDescriptionTimestamped?: string;
  socialHashtags?: string;
}

export async function fetchClipperExports(projectId: string): Promise<ClipperExportRecord[]> {
  return invoke<ClipperExportRecord[]>("clipper_exports_list", { projectId });
}

export async function fetchClipperExport(exportId: string): Promise<ClipperExportRecord> {
  return invoke<ClipperExportRecord>("clipper_export_get", { exportId });
}

export async function patchClipperExportSocial(
  exportId: string,
  patch: ClipperExportSocialPatch,
  mode: "overwrite" | "fill_missing" = "overwrite",
): Promise<ClipperExportRecord> {
  return invoke<ClipperExportRecord>("clipper_export_patch_social", {
    exportId,
    patch,
    mode,
  });
}

export async function getOpenClipperMcpPath(): Promise<string> {
  return invoke<string>("get_open_clipper_mcp_path");
}

export async function getOpenClipperMcpHttpUrl(): Promise<string> {
  return invoke<string>("get_open_clipper_mcp_http_url");
}

export async function upsertClipperExport(
  projectId: string,
  input: UpsertClipperExportInput,
): Promise<ClipperExportRecord> {
  return invoke<ClipperExportRecord>("clipper_export_upsert", { projectId, export: input });
}

export interface ClipperExportPublishRecord {
  id: string;
  exportId: string;
  platform: string;
  status: "pending" | "succeeded" | "failed";
  jobId?: string;
  externalId?: string;
  watchUrl?: string;
  errorMessage?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClipperExportMapItem {
  id: string;
  projectId: string;
  projectName: string;
  clipperOwnerId?: string | null;
  clipperOwnerName?: string | null;
  clipIndex: number;
  formatId: string;
  platform: string;
  formatLabel: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  clipStartSec?: number;
  clipEndSec?: number;
  exportedAt: string;
  transcriptPlain: string;
  transcriptTimestamped: string;
  socialTitle: string;
  socialShortDescription: string;
  socialDescription: string;
  socialDescriptionTimestamped: string;
  socialHashtags: string;
  createdAt: string;
  updatedAt: string;
  missingFields: string[];
  hasTranscript: boolean;
  publishStatus?: ClipperExportPublishRecord;
  isPublished: boolean;
}

export interface ClipperExportPublishUpsertInput {
  exportId: string;
  platform: string;
  status: "pending" | "succeeded" | "failed";
  jobId?: string;
  externalId?: string;
  watchUrl?: string;
  errorMessage?: string;
  publishedAt?: string;
}

export async function fetchClipperExportsAll(
  projectId?: string,
): Promise<ClipperExportMapItem[]> {
  return invoke<ClipperExportMapItem[]>("clipper_exports_list_all", { projectId });
}

export async function upsertClipperExportPublish(
  input: ClipperExportPublishUpsertInput,
): Promise<ClipperExportPublishRecord> {
  return invoke<ClipperExportPublishRecord>("clipper_export_publish_upsert", { publish: input });
}

export async function fetchClipperExportPublishes(
  exportId: string,
): Promise<ClipperExportPublishRecord[]> {
  return invoke<ClipperExportPublishRecord[]>("clipper_export_publishes_list", { exportId });
}

export interface ClipperExportsPurgeResult {
  removedMissingOnDisk: number;
  removedOrphanedProjects: number;
}

export async function purgeClipperExportsMissing(
  projectId?: string,
): Promise<ClipperExportsPurgeResult> {
  return invoke<ClipperExportsPurgeResult>("clipper_exports_purge_missing", { projectId });
}
