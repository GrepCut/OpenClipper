import axios from "axios";
import { apiClient } from "../shared/utils/api-client.util";
import type {
  SocialPrivacyStatus,
  SocialPublishJobStatus,
  SocialPublishResponse,
} from "./types/social-auth.types";

export interface R2StagingPublishParams {
  platform: "facebook" | "instagram" | "threads";
  projectId: string;
  exportId: string;
  connectionId?: string;
  video: File;
  clipIndex: number;
  formatId: string;
  title: string;
  description?: string;
  privacyStatus: SocialPrivacyStatus;
  onUploadProgress?: (progress: number) => void;
  onUploadPhaseChange?: (phase: "uploading" | "publishing") => void;
}

async function uploadPartsToR2(
  video: File,
  jobId: string,
  platform: "facebook" | "instagram" | "threads",
  partSize: number,
  totalParts: number,
  onUploadProgress?: (progress: number) => void,
): Promise<void> {
  let uploaded = 0;
  const parts: Array<{ partNumber: number; etag: string }> = [];

  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const urls = await apiClient.post<Array<{ partNumber: number; url: string }>>(
      `/social/${platform}/clipper/staging/${jobId}/parts`,
      { partNumbers: [partNumber] },
    );
    const start = (partNumber - 1) * partSize;
    const blob = video.slice(start, Math.min(start + partSize, video.size));
    const response = await axios.put(urls.data[0].url, blob, {
      headers: { "Content-Type": video.type || "video/mp4" },
      withCredentials: false,
      onUploadProgress: (event) => {
        const current = uploaded + event.loaded;
        onUploadProgress?.(Math.min(1, current / video.size));
      },
    });
    const etag = String(response.headers.etag || response.headers.ETag || "");
    if (!etag) {
      throw new Error("R2 upload did not return an ETag. Check bucket CORS configuration.");
    }
    parts.push({ partNumber, etag });
    uploaded += blob.size;
    onUploadProgress?.(Math.min(1, uploaded / video.size));
  }

  await apiClient.post(`/social/${platform}/clipper/staging/${jobId}/complete`, {
    parts,
  });
}

export async function publishClipperViaR2Staging(
  params: R2StagingPublishParams,
): Promise<SocialPublishResponse> {
  const staging = await apiClient.post<{
    jobId: string;
    partSize: number;
    totalParts: number;
  }>(`/social/${params.platform}/clipper/staging`, {
    projectId: params.projectId,
    exportId: params.exportId,
    connectionId: params.connectionId,
    clipIndex: params.clipIndex,
    formatId: params.formatId,
    fileName: params.video.name || "clip.mp4",
    mimeType: params.video.type || "video/mp4",
    fileSize: params.video.size,
    title: params.title,
    description: params.description,
    privacyStatus: params.privacyStatus,
  });

  const { jobId, partSize, totalParts } = staging.data;
  await uploadPartsToR2(
    params.video,
    jobId,
    params.platform,
    partSize,
    totalParts,
    params.onUploadProgress,
  );

  params.onUploadPhaseChange?.("publishing");
  const response = await apiClient.post<{
    jobId: string;
    status: SocialPublishJobStatus;
  }>(`/social/${params.platform}/clipper/publish/${jobId}`);

  if (response.data.status === "processing") {
    const polled = await pollPublishJob(response.data.jobId);
    return {
      jobId: polled.id,
      status: polled.status,
      externalId: polled.externalId ?? undefined,
      watchUrl: polled.watchUrl ?? undefined,
    };
  }

  const status = await apiClient.get(`/social/publish/${response.data.jobId}`);
  return {
    jobId: response.data.jobId,
    status: response.data.status,
    externalId: status.data.externalId ?? undefined,
    watchUrl: status.data.watchUrl ?? undefined,
  };
}

async function pollPublishJob(jobId: string) {
  const maxAttempts = 40;
  const intervalMs = 3000;
  let last = await apiClient.get(`/social/publish/${jobId}`).then((r) => r.data);
  for (let i = 0; i < maxAttempts; i++) {
    if (last.status === "published" || last.status === "failed") {
      return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await apiClient.get(`/social/publish/${jobId}`).then((r) => r.data);
  }
  return last;
}
