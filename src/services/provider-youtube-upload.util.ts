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

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(params.video.size),
    },
    body: params.video,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(errText || `YouTube upload failed (${uploadRes.status})`);
  }

  params.onUploadProgress?.(1);

  const uploadJson = (await uploadRes.json()) as { id?: string };
  const videoId = uploadJson.id;
  if (!videoId) {
    throw new Error("YouTube upload succeeded but no video ID was returned");
  }

  return {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
