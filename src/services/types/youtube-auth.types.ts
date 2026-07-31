export type YoutubePrivacyStatus = "private" | "unlisted" | "public";

export type YoutubePublishJobStatus =
  | "pending"
  | "uploading"
  | "processing"
  | "published"
  | "failed";

export type YoutubeConnectionReason = "no_refresh_token" | "api_check_failed";

export interface SocialConnectionSummary {
  id: string;
  displayName: string | null;
  externalAccountId: string | null;
  googleEmail?: string | null;
}

export interface YoutubeStatusResponse {
  connections: SocialConnectionSummary[];
  connected: boolean;
  /** @deprecated Use connections[].displayName */
  channelTitle?: string;
  reason?: YoutubeConnectionReason;
}

export interface YoutubeDisconnectResponse {
  disconnected: boolean;
}

export interface YoutubePublishResponse {
  jobId: string;
  status: YoutubePublishJobStatus;
  youtubeVideoId?: string;
  watchUrl?: string;
}

export interface YoutubePublishJobStatusResponse {
  id: string;
  status: YoutubePublishJobStatus;
  youtubeVideoId: string | null;
  watchUrl: string | null;
  error: string | null;
  title: string;
  clipIndex: number;
  formatId: string;
}

export interface PublishClipperToYoutubeParams {
  projectId: string;
  exportId: string;
  connectionId?: string;
  video: File;
  clipIndex: number;
  formatId: string;
  title: string;
  description?: string;
  privacyStatus: YoutubePrivacyStatus;
  /** Manifest/expected size — used when video.size is unavailable before upload. */
  expectedFileSize?: number;
  onUploadProgress?: (progress: number) => void;
  /** Fired once the browser has finished sending the multipart body to our API. */
  onUploadPhaseChange?: (phase: "uploading" | "publishing") => void;
}
