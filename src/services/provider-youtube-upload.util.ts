import axios from "axios";
import type { SocialPrivacyStatus } from "./types/social-auth.types";

export interface YoutubeDirectUploadParams {
  accessToken: string;
  video: File;
  title: string;
  description?: string;
  privacyStatus: SocialPrivacyStatus;
  onUploadProgress?: (progress: number) => void;
}

export interface YoutubeDirectUploadResult {
  videoId: string;
  watchUrl: string;
}

export async function uploadVideoToYoutube(
  params: YoutubeDirectUploadParams,
): Promise<YoutubeDirectUploadResult> {
  const mimeType = params.video.type || "video/mp4";
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(params.video.size),
      },
      body: JSON.stringify({
        snippet: {
          title: params.title,
          description: params.description ?? undefined,
        },
        status: {
          privacyStatus: params.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(errText || `YouTube upload init failed (${initRes.status})`);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return an upload URL");
  }

  const uploadRes = await axios.put(uploadUrl, params.video, {
    headers: { "Content-Type": mimeType },
    withCredentials: false,
    validateStatus: () => true,
    onUploadProgress: (event) => {
      const total = event.total || params.video.size;
      if (!total) return;
      params.onUploadProgress?.(Math.min(1, event.loaded / total));
    },
  });

  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    const errText =
      typeof uploadRes.data === "string"
        ? uploadRes.data
        : JSON.stringify(uploadRes.data ?? {});
    throw new Error(errText || `YouTube upload failed (${uploadRes.status})`);
  }

  params.onUploadProgress?.(1);

  const uploadJson = (uploadRes.data ?? {}) as { id?: string };
  const videoId = uploadJson.id;
  if (!videoId) {
    throw new Error("YouTube upload succeeded but no video ID was returned");
  }

  return {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
