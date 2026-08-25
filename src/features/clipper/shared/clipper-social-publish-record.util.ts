import type { SocialPublishablePlatform } from "../../../services/social-auth.service";
import { isTauri } from "../../../shared/utils/platform.util";
import {
  upsertClipperExportPublish,
  type ClipperExportPublishRecord,
} from "../persistence/clipper-export-db-api.util";
import { clipperError } from "./logger.util";

export function sanitizeSocialWatchUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.includes("v_pub_")) return undefined;
  return url;
}

export function normalizePublishStatus(
  status: string,
  watchUrl?: string,
): ClipperExportPublishRecord["status"] {
  if (status === "failed") return "failed";
  if (status === "succeeded" || status === "published" || Boolean(sanitizeSocialWatchUrl(watchUrl))) {
    return "succeeded";
  }
  return "pending";
}

export function buildClipperExportPublishRecord(input: {
  exportId: string;
  platform: SocialPublishablePlatform;
  status: ClipperExportPublishRecord["status"];
  jobId?: string;
  watchUrl?: string;
  externalId?: string;
  errorMessage?: string;
}): ClipperExportPublishRecord {
  const now = new Date().toISOString();
  return {
    id: input.jobId ?? `${input.exportId}:${input.platform}`,
    exportId: input.exportId,
    platform: input.platform,
    status: input.status,
    jobId: input.jobId,
    watchUrl: sanitizeSocialWatchUrl(input.watchUrl),
    externalId: input.externalId,
    errorMessage: input.errorMessage,
    publishedAt: input.status === "succeeded" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export async function persistPublishRecord(
  input: Parameters<typeof buildClipperExportPublishRecord>[0],
  onComplete?: (record: ClipperExportPublishRecord) => void,
): Promise<void> {
  onComplete?.(buildClipperExportPublishRecord(input));
  if (!isTauri()) return;
  try {
    const record = await upsertClipperExportPublish({
      exportId: input.exportId,
      platform: input.platform,
      status: input.status,
      jobId: input.jobId,
      watchUrl: sanitizeSocialWatchUrl(input.watchUrl),
      externalId: input.externalId,
      errorMessage: input.errorMessage,
    });
    onComplete?.(record);
  } catch (error) {
    clipperError("publish: persist record failed", error);
  }
}

export function publishErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message
    || (error instanceof Error ? error.message : fallback)
  );
}

export function isYoutubeReauthRequired(error: unknown, message: string): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 401 || /authorization expired|connect youtube again/i.test(message);
}
