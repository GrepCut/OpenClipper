import type { SocialPrivacyStatus } from "./types/social-auth.types";

interface XMediaResponse {
  data?: {
    id?: string;
    processing_info?: { state?: string; check_after_secs?: number };
  };
  errors?: Array<{ detail?: string; title?: string }>;
  detail?: string;
  title?: string;
}

async function readXJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body.trim()) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`X returned invalid JSON (HTTP ${response.status})`);
  }
}

function xApiError(response: Response, body: XMediaResponse, fallback: string): Error {
  return new Error(
    body.errors?.[0]?.detail ||
      body.errors?.[0]?.title ||
      body.detail ||
      body.title ||
      `${fallback} (HTTP ${response.status})`,
  );
}

export interface XDirectUploadParams {
  accessToken: string;
  video: File;
  title: string;
  description?: string;
  onUploadProgress?: (progress: number) => void;
}

export interface XDirectUploadResult {
  tweetId: string;
  watchUrl: string;
}

export async function uploadVideoToX(
  params: XDirectUploadParams,
): Promise<XDirectUploadResult> {
  const buffer = await params.video.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const mimeType = params.video.type || "video/mp4";
  const mediaId = await uploadMediaChunked(
    params.accessToken,
    bytes,
    mimeType,
    params.onUploadProgress,
  );

  const text = [params.title, params.description]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 280);

  const tweetRes = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      media: { media_ids: [mediaId] },
    }),
  });
  const tweetJson = await readXJson<XMediaResponse>(tweetRes);
  if (!tweetRes.ok || !tweetJson.data?.id) {
    throw xApiError(tweetRes, tweetJson, "X post creation failed");
  }

  return {
    tweetId: tweetJson.data.id,
    watchUrl: `https://x.com/i/status/${tweetJson.data.id}`,
  };
}

async function uploadMediaChunked(
  accessToken: string,
  buffer: Uint8Array,
  mimeType: string,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const initRes = await fetch("https://api.x.com/2/media/upload/initialize", {
    method: "POST",
    headers: {
      ...authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      total_bytes: buffer.byteLength,
      media_type: mimeType,
      media_category: "tweet_video",
    }),
  });
  const initJson = await readXJson<XMediaResponse>(initRes);
  if (!initRes.ok || !initJson.data?.id) {
    throw xApiError(initRes, initJson, "X media initialization failed");
  }
  const mediaId = initJson.data.id;

  const chunkSize = 5 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
    const chunk = buffer.subarray(offset, offset + chunkSize);
    const form = new FormData();
    form.append("segment_index", String(segmentIndex));
    form.append("media", new Blob([chunk]), "chunk.mp4");
    const appendRes = await fetch(
      `https://api.x.com/2/media/upload/${mediaId}/append`,
      {
        method: "POST",
        headers: authorization,
        body: form,
      },
    );
    const appendJson = await readXJson<XMediaResponse>(appendRes);
    if (!appendRes.ok) {
      throw xApiError(appendRes, appendJson, "X media append failed");
    }
    segmentIndex += 1;
    onProgress?.(Math.min(1, (offset + chunk.byteLength) / buffer.byteLength));
  }

  const finalizeRes = await fetch(
    `https://api.x.com/2/media/upload/${mediaId}/finalize`,
    {
      method: "POST",
      headers: authorization,
    },
  );
  const finalizeJson = await readXJson<XMediaResponse>(finalizeRes);
  if (!finalizeRes.ok) {
    throw xApiError(finalizeRes, finalizeJson, "X media finalization failed");
  }

  let processing = finalizeJson.data?.processing_info;
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new Error("X media processing failed");
    }
    await new Promise((r) =>
      setTimeout(r, (processing?.check_after_secs ?? 2) * 1000),
    );
    const statusRes = await fetch(
      `https://api.x.com/2/media/upload?command=STATUS&media_id=${mediaId}`,
      { headers: authorization },
    );
    const statusJson = await readXJson<XMediaResponse>(statusRes);
    if (!statusRes.ok) {
      throw xApiError(statusRes, statusJson, "X media status check failed");
    }
    processing = statusJson.data?.processing_info;
  }

  onProgress?.(1);
  return mediaId;
}
