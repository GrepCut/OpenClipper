import { apiClient } from "../shared/utils/api-client.util";
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
    console.log("[YouTube Auth] checkYoutubeConnection: requesting /auth/google/youtube/status");
    try {
      const response = await apiClient.get<YoutubeStatusResponse>(
        "/auth/google/youtube/status",
      );
      console.log("[YouTube Auth] checkYoutubeConnection: response", {
        status: response.status,
        data: response.data,
      });
      return response.data;
    } catch (error) {
      console.error("[YouTube Auth] checkYoutubeConnection: request failed", error);
      throw error;
    }
  },

  disconnectYoutube(connectionId?: string): Promise<YoutubeDisconnectResponse> {
    const params = connectionId
      ? `?connectionId=${encodeURIComponent(connectionId)}`
      : "";
    return apiClient
      .get<YoutubeDisconnectResponse>(`/auth/google/youtube/disconnect${params}`)
      .then((res) => res.data);
  },

  async publishClipperExport(
    params: PublishClipperToYoutubeParams,
  ): Promise<YoutubePublishResponse> {
    const uploadSize = params.video.size || params.expectedFileSize || 0;
    if (uploadSize < 1024) {
      throw new Error("Video file is empty or too small to upload.");
    }

    const formData = new FormData();
    // Text fields must precede the file — @fastify/multipart reads parts in order and
    // blocks on unconsumed file streams before later fields can be parsed.
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
    if (params.connectionId) {
      formData.append("connectionId", params.connectionId);
    }
    formData.append("video", params.video);

    const response = await apiClient.post<YoutubePublishResponse>(
      "/auth/google/youtube/clipper/publish",
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
  ): Promise<YoutubePublishJobStatusResponse> {
    const response = await apiClient.get<YoutubePublishJobStatusResponse>(
      `/auth/google/youtube/publish/${jobId}`,
    );
    return response.data;
  },
};
