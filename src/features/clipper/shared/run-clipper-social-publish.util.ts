import {
  oauthFlowForPlatform,
  socialAuthService,
  type SocialPrivacyStatus,
  type SocialPublishablePlatform,
  type TikTokCreatorInfo,
} from "../../../services/social-auth.service";
import type { TikTokPostOptions } from "../../../services/types/social-auth.types";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import { getPreciseVideoDuration } from "../lib/media/get-precise-video-duration.util";

export type SocialPublishUploadPhase = "uploading" | "publishing";

export interface SocialPublishRunResult {
  jobId: string;
  status: string;
  watchUrl?: string;
  externalId?: string;
}

export async function runClipperSocialPublish(params: {
  platform: SocialPublishablePlatform;
  platformLabel: string;
  projectId: string;
  exportId: string;
  connectionId: string;
  video: File;
  clipIndex: number;
  formatId: string;
  title: string;
  description: string;
  privacyStatus: SocialPrivacyStatus;
  expectedFileSize?: number;
  tiktokCreator: TikTokCreatorInfo | null;
  tiktokOptions?: Omit<TikTokPostOptions, "caption" | "durationSeconds">;
  onUploadProgress: (ratio: number) => void;
  onUploadPhaseChange: (phase: SocialPublishUploadPhase) => void;
}): Promise<SocialPublishRunResult> {
  const {
    platform,
    platformLabel,
    projectId,
    exportId,
    connectionId,
    video,
    clipIndex,
    formatId,
    title,
    description,
    privacyStatus,
    expectedFileSize,
    tiktokCreator,
    tiktokOptions,
    onUploadProgress,
    onUploadPhaseChange,
  } = params;

  if (platform === "tiktok") {
    if (!tiktokCreator || !tiktokOptions) {
      throw new Error("Choose TikTok privacy and confirm Music Usage before publishing.");
    }
    const durationSeconds = await getPreciseVideoDuration(video);
    if (
      tiktokCreator.maxVideoPostDurationSec
      && durationSeconds > tiktokCreator.maxVideoPostDurationSec
    ) {
      throw new Error(
        `This TikTok account allows videos up to ${tiktokCreator.maxVideoPostDurationSec} seconds.`,
      );
    }
    return socialAuthService.publishClipperToTikTok({
      projectId,
      exportId,
      connectionId,
      video,
      clipIndex,
      formatId,
      options: {
        caption: title,
        durationSeconds,
        ...tiktokOptions,
      },
      onUploadProgress,
      onUploadPhaseChange,
    });
  }

  if (platform === "youtube" && oauthFlowForPlatform(platform) === "youtube") {
    const yt = await youtubeAuthService.publishClipperExport({
      projectId,
      exportId,
      connectionId,
      video,
      clipIndex,
      formatId,
      title,
      description: description || undefined,
      privacyStatus,
      expectedFileSize,
      onUploadProgress,
      onUploadPhaseChange,
    });
    return {
      jobId: yt.jobId,
      status: yt.status,
      watchUrl: yt.watchUrl,
      externalId: yt.youtubeVideoId,
    };
  }

  let response = await socialAuthService.publishClipperExport({
    platform,
    connectionId,
    projectId,
    exportId,
    video,
    clipIndex,
    formatId,
    title,
    description: description || undefined,
    privacyStatus,
    expectedFileSize,
    onUploadProgress,
    onUploadPhaseChange,
  });

  if (response.status === "processing") {
    onUploadPhaseChange("publishing");
    const polled = await socialAuthService.pollUntilTerminal(response.jobId);
    response = {
      jobId: polled.id,
      status: polled.status,
      watchUrl: polled.watchUrl ?? undefined,
      externalId: polled.externalId ?? undefined,
    };
    if (polled.status === "failed") {
      throw new Error(polled.error || `${platformLabel} publish failed`);
    }
  }

  return response;
}
