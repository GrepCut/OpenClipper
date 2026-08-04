import { apiClient } from "../shared/utils/api-client.util";
import axios from "axios";
import { openExternalAuthUrl } from "../shared/utils/desktop-auth.util";
import { getAuthClient } from "../shared/utils/auth-client.util";
import { logIntegration } from "../shared/utils/integration-logger.util";
import { publishClipperViaR2Staging } from "./social-r2-staging.util";
import { uploadVideoToX } from "./provider-x-upload.util";
import type {
  PublishClipperToSocialParams,
  SocialDisconnectResponse,
  SocialOAuthFlow,
  SocialPublishJobStatus,
  SocialPublishJobStatusResponse,
  SocialPublishResponse,
  SocialPublishablePlatform,
  SocialStatusResponse,
  MetaTargetsResponse,
  TikTokCreatorInfo,
  PublishClipperToTikTokParams,
} from "./types/social-auth.types";

export * from "./types/social-auth.types";

export const socialAuthService = {
  async redirectToConnect(
    flow: SocialOAuthFlow,
    returnPath?: string,
  ): Promise<void> {
    const client = getAuthClient();
    const params = new URLSearchParams();
    params.append("client", client);
    if (returnPath) params.append("returnPath", returnPath);

    logIntegration("oauth.connect_start", {
      flow,
      client,
      returnPath: returnPath ?? null,
    });

    try {
      const response = await apiClient.get<{ url: string }>(
        `/social/${flow}/authorize?${params.toString()}`,
      );

      logIntegration("oauth.authorize_url_received", {
        flow,
        client,
        url: response.data.url,
      });

      await openExternalAuthUrl(response.data.url);

      logIntegration("oauth.browser_opened", {
        flow,
        client,
        url: response.data.url,
      });
    } catch (error: unknown) {
      logIntegration("oauth.connect_failed", {
        flow,
        client,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    connectionId?: string,
  ): Promise<SocialDisconnectResponse> {
    const params = connectionId
      ? `?connectionId=${encodeURIComponent(connectionId)}`
      : "";
    return apiClient
      .get<SocialDisconnectResponse>(`/social/${platform}/disconnect${params}`)
      .then((res) => res.data);
  },

  async getMetaTargets(): Promise<MetaTargetsResponse> {
    const response = await apiClient.get<MetaTargetsResponse>("/social/meta/targets");
    return response.data;
  },

  async selectMetaTarget(pageId: string, metaConnectionId?: string): Promise<void> {
    await apiClient.post("/social/meta/targets/select", {
      pageId,
      metaConnectionId,
    });
  },

  async publishClipperExport(
    params: PublishClipperToSocialParams,
  ): Promise<SocialPublishResponse> {
    if (params.platform === "facebook" || params.platform === "instagram" || params.platform === "threads") {
      return publishClipperViaR2Staging({
        platform: params.platform,
        projectId: params.projectId,
        exportId: params.exportId,
        connectionId: params.connectionId,
        video: params.video,
        clipIndex: params.clipIndex,
        formatId: params.formatId,
        title: params.title,
        description: params.description,
        privacyStatus: params.privacyStatus,
        onUploadProgress: params.onUploadProgress,
        onUploadPhaseChange: params.onUploadPhaseChange,
      });
    }

    if (params.platform === "x") {
      return this.publishClipperToX(params);
    }

    throw new Error(`${params.platform} uses a dedicated client-direct publish flow`);
  },

  async publishClipperToX(
    params: PublishClipperToSocialParams,
  ): Promise<SocialPublishResponse> {
    const uploadSize = params.video.size || params.expectedFileSize || 0;
    if (uploadSize < 1024) {
      throw new Error("Video file is empty or too small to upload.");
    }

    const init = await apiClient.post<{
      jobId: string;
      accessToken: string;
      expiresAt: string;
    }>("/social/x/clipper/publish/init", {
      projectId: params.projectId,
      exportId: params.exportId,
      connectionId: params.connectionId,
      clipIndex: params.clipIndex,
      formatId: params.formatId,
      title: params.title,
      description: params.description,
      privacyStatus: params.privacyStatus,
      fileName: params.video.name || "clip.mp4",
      mimeType: params.video.type || "video/mp4",
      fileSize: uploadSize,
    });

    const { jobId, accessToken } = init.data;

    try {
      const uploaded = await uploadVideoToX({
        accessToken,
        video: params.video,
        title: params.title,
        description: params.description,
        onUploadProgress: (ratio) => {
          params.onUploadProgress?.(ratio);
          if (ratio >= 1) {
            params.onUploadPhaseChange?.("publishing");
          }
        },
      });

      await apiClient.post(`/social/publish/${jobId}/complete`, {
        externalId: uploaded.tweetId,
        watchUrl: uploaded.watchUrl,
      });

      return {
        jobId,
        status: "published",
        externalId: uploaded.tweetId,
        watchUrl: uploaded.watchUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "X upload failed";
      await apiClient.post(`/social/publish/${jobId}/complete`, { error: message });
      throw error;
    }
  },
  async getPublishJobStatus(
    jobId: string,
  ): Promise<SocialPublishJobStatusResponse> {
    const response = await apiClient.get<SocialPublishJobStatusResponse>(
      `/social/publish/${jobId}`,
    );
    return response.data;
  },

  async getTikTokCreatorInfo(connectionId?: string): Promise<TikTokCreatorInfo> {
    const params = connectionId
      ? `?connectionId=${encodeURIComponent(connectionId)}`
      : "";
    const response = await apiClient.get<TikTokCreatorInfo>(
      `/social/tiktok/creator-info${params}`,
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
      connectionId: params.connectionId,
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
