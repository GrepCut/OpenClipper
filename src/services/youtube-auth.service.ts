import { apiClient } from "../shared/utils/api-client.util";
import { uploadVideoToYoutube } from "./provider-youtube-upload.util";
import { openExternalAuthUrl } from "../shared/utils/desktop-auth.util";
import { getAuthClient } from "../shared/utils/auth-client.util";
import { logIntegration } from "../shared/utils/integration-logger.util";
import type {
  PublishClipperToYoutubeParams,
  YoutubeDisconnectResponse,
  YoutubePublishJobStatusResponse,
  YoutubePublishResponse,
  YoutubeStatusResponse,
} from "./types/youtube-auth.types";

export * from "./types/youtube-auth.types";

export const youtubeAuthService = {
  async redirectToYoutubeConnect(returnPath?: string): Promise<void> {
    const client = getAuthClient();
    const params = new URLSearchParams();
    params.append("client", client);
    if (returnPath) params.append("returnPath", returnPath);

    logIntegration("oauth.connect_start", {
      flow: "youtube",
      client,
      returnPath: returnPath ?? null,
    });

    const response = await apiClient.get<{ url: string }>(
      `/social/youtube/authorize?${params.toString()}`,
    );

    logIntegration("oauth.authorize_url_received", {
      flow: "youtube",
      client,
      url: response.data.url,
    });

    await openExternalAuthUrl(response.data.url);

    logIntegration("oauth.browser_opened", {
      flow: "youtube",
      client,
      url: response.data.url,
    });
  },

  async checkYoutubeConnection(): Promise<YoutubeStatusResponse> {
    const response = await apiClient.get<YoutubeStatusResponse>(
      "/social/youtube/status",
    );
    return response.data;
  },

  disconnectYoutube(connectionId?: string): Promise<YoutubeDisconnectResponse> {
    const params = connectionId
      ? `?connectionId=${encodeURIComponent(connectionId)}`
      : "";
    return apiClient
      .get<YoutubeDisconnectResponse>(`/social/youtube/disconnect${params}`)
      .then((res) => res.data);
  },

  async publishClipperExport(
    params: PublishClipperToYoutubeParams,
  ): Promise<YoutubePublishResponse> {
    const uploadSize = params.video.size || params.expectedFileSize || 0;
    if (uploadSize < 1024) {
      throw new Error("Video file is empty or too small to upload.");
    }

    const init = await apiClient.post<{
      jobId: string;
      accessToken: string;
      expiresAt: string;
    }>("/social/youtube/clipper/publish/init", {
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
      const uploaded = await uploadVideoToYoutube({
        accessToken,
        video: params.video,
        title: params.title,
        description: params.description,
        privacyStatus: params.privacyStatus,
        onUploadProgress: (ratio) => {
          params.onUploadProgress?.(ratio);
          if (ratio >= 1) {
            params.onUploadPhaseChange?.("publishing");
          }
        },
      });

      await apiClient.post(`/social/publish/${jobId}/complete`, {
        externalId: uploaded.videoId,
        watchUrl: uploaded.watchUrl,
      });

      return {
        jobId,
        status: "published",
        youtubeVideoId: uploaded.videoId,
        watchUrl: uploaded.watchUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube upload failed";
      await apiClient.post(`/social/publish/${jobId}/complete`, { error: message });
      throw error;
    }
  },

  async getPublishJobStatus(
    jobId: string,
  ): Promise<YoutubePublishJobStatusResponse> {
    const response = await apiClient.get<YoutubePublishJobStatusResponse>(
      `/social/publish/${jobId}`,
    );
    return response.data;
  },
};
