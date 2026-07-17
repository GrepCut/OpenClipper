import { apiClient } from "../shared/utils/apiClient";
import axios from "axios";
import { openExternalAuthUrl } from "../shared/utils/desktopAuth";
import { getAuthClient } from "../shared/utils/auth-client";
import type {
  PublishClipperToSocialParams,
  SocialDisconnectResponse,
  SocialOAuthFlow,
  SocialPublishJobStatusResponse,
  SocialPublishResponse,
  SocialPublishablePlatform,
  SocialStatusResponse,
  MetaTargetsResponse,
  TikTokCreatorInfo,
  PublishClipperToTikTokParams,
} from "./types/socialAuth.types";

export * from "./types/socialAuth.types";

export const socialAuthService = {
  async redirectToConnect(
    flow: SocialOAuthFlow,
    returnPath?: string,
  ): Promise<void> {
    const client = getAuthClient();
    const params = new URLSearchParams();
    params.append("client", client);
    if (returnPath) params.append("returnPath", returnPath);

    const response = await apiClient.get<{ url: string }>(
      `/social/${flow}/authorize?${params.toString()}`,
    );
    await openExternalAuthUrl(response.data.url);
  },

  async checkConnection(
    platform: SocialPublishablePlatform,
  ): Promise<SocialStatusResponse> {
    const response = await apiClient.get<SocialStatusResponse>(
      `/social/${platform}/status`,
    );
    return response.data;
  },

  disconnect(
    platform: SocialPublishablePlatform,
  ): Promise<SocialDisconnectResponse> {
    return apiClient
      .get<SocialDisconnectResponse>(`/social/${platform}/disconnect`)
      .then((res) => res.data);
  },

  async getMetaTargets(): Promise<MetaTargetsResponse> {
    const response = await apiClient.get<MetaTargetsResponse>("/social/meta/targets");
    return response.data;
  },

  async selectMetaTarget(pageId: string): Promise<void> {
    await apiClient.post("/social/meta/targets/select", { pageId });
  },

  async publishClipperExport(
    params: PublishClipperToSocialParams,
  ): Promise<SocialPublishResponse> {
    const uploadSize = params.video.size || params.expectedFileSize || 0;
    if (uploadSize < 1024) {
      throw new Error("Video file is empty or too small to upload.");
    }

    const formData = new FormData();
    formData.append("clientProjectId", params.projectId);
    formData.append("exportId", params.exportId);
    formData.append("clipIndex", String(params.clipIndex));
    formData.append("formatId", params.formatId);
    formData.append("title", params.title);
    formData.append("fileSize", String(uploadSize));
    if (params.description) {
      formData.append("description", params.description);
    }
    formData.append("privacyStatus", params.privacyStatus);
    formData.append("video", params.video);

    const response = await apiClient.post<SocialPublishResponse>(
      `/social/${params.platform}/clipper/publish`,
      formData,
      {
        timeout: 1_800_000,
        onUploadProgress: (event) => {
          if (!event.total) return;
          const ratio = event.loaded / event.total;
          params.onUploadProgress?.(ratio);
          if (ratio >= 1) {
            params.onUploadPhaseChange?.("publishing");
          }
        },
      },
    );

    return response.data;
  },

  async getPublishJobStatus(
    jobId: string,
  ): Promise<SocialPublishJobStatusResponse> {
    const response = await apiClient.get<SocialPublishJobStatusResponse>(
      `/social/publish/${jobId}`,
    );
    return response.data;
  },

  async getTikTokCreatorInfo(): Promise<TikTokCreatorInfo> {
    const response = await apiClient.get<TikTokCreatorInfo>(
      "/social/tiktok/creator-info",
    );
    return response.data;
  },

  async publishClipperToTikTok(
    params: PublishClipperToTikTokParams,
  ): Promise<SocialPublishResponse> {
    const staging = await apiClient.post<{
      jobId: string;
      partSize: number;
      totalParts: number;
    }>("/social/tiktok/clipper/staging", {
      projectId: params.projectId,
      exportId: params.exportId,
      clipIndex: params.clipIndex,
      formatId: params.formatId,
      fileName: params.video.name || "clip.mp4",
      mimeType: params.video.type || "video/mp4",
      fileSize: params.video.size,
      options: params.options,
    });

    const { jobId, partSize, totalParts } = staging.data;
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let uploaded = 0;
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const urls = await apiClient.post<Array<{ partNumber: number; url: string }>>(
        `/social/tiktok/clipper/staging/${jobId}/parts`,
        { partNumbers: [partNumber] },
      );
      const start = (partNumber - 1) * partSize;
      const blob = params.video.slice(start, Math.min(start + partSize, params.video.size));
      // Presigned R2 URLs must not receive our API bearer token or cookies.
      const response = await axios.put(urls.data[0].url, blob, {
        headers: { "Content-Type": params.video.type || "video/mp4" },
        withCredentials: false,
        onUploadProgress: (event) => {
          const current = uploaded + event.loaded;
          params.onUploadProgress?.(Math.min(1, current / params.video.size));
        },
      });
      const etag = String(response.headers.etag || response.headers.ETag || "");
      if (!etag) throw new Error("R2 upload did not return an ETag. Check bucket CORS configuration.");
      parts.push({ partNumber, etag });
      uploaded += blob.size;
      params.onUploadProgress?.(Math.min(1, uploaded / params.video.size));
    }

    await apiClient.post(`/social/tiktok/clipper/staging/${jobId}/complete`, { parts });
    params.onUploadPhaseChange?.("publishing");
    const response = await apiClient.post<{
      jobId: string;
      status: SocialPublishJobStatus;
    }>(`/social/tiktok/clipper/publish/${jobId}`);
    return response.data;
  },

  async pollUntilTerminal(
    jobId: string,
    options?: { maxAttempts?: number; intervalMs?: number },
  ): Promise<SocialPublishJobStatusResponse> {
    const maxAttempts = options?.maxAttempts ?? 40;
    const intervalMs = options?.intervalMs ?? 3000;
    let last = await this.getPublishJobStatus(jobId);
    for (let i = 0; i < maxAttempts; i++) {
      if (last.status === "published" || last.status === "failed") {
        return last;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
      last = await this.getPublishJobStatus(jobId);
    }
    return last;
  },
};
