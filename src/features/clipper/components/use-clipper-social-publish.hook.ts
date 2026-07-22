import { useEffect, useMemo, useState } from "react";
import { getClipperFormatDef } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import {
  oauthFlowForPlatform,
  publishPlatformForFormat,
  socialAuthService,
  type SocialPrivacyStatus,
  type SocialPublishablePlatform,
  type TikTokCreatorInfo,
  type TikTokPrivacyLevel,
} from "../../../services/social-auth.service";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import { appToast } from "../../../shared/utils/toast.service";
import { resolveClipperExportUploadFile } from "../persistence/resolve-export-upload-file.util";
import { getPreciseVideoDuration } from "../lib/media/get-precise-video-duration.util";
import { PLATFORM_LABELS } from "./clipper-social-publish-dialog.constants";

export function useClipperSocialPublish({
  isOpen,
  result,
  sourceFileName,
  defaultConnected,
  requestedPlatform,
  projectId,
  onRequestConnect,
}: {
  isOpen: boolean;
  result: ClipperFormatResult | null;
  sourceFileName: string | null;
  defaultConnected: boolean;
  requestedPlatform?: SocialPublishablePlatform;
  projectId: string;
  onRequestConnect: (platform: SocialPublishablePlatform) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState<SocialPrivacyStatus>("private");
  const [isPublishing, setIsPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "publishing">("uploading");
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [tiktokCreator, setTikTokCreator] = useState<TikTokCreatorInfo | null>(null);
  const [tiktokPrivacy, setTikTokPrivacy] = useState<TikTokPrivacyLevel | "">("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [isAigc, setIsAigc] = useState(false);
  const [musicUsageConfirmed, setMusicUsageConfirmed] = useState(false);
  const [tiktokError, setTikTokError] = useState<string | null>(null);

  const platform: SocialPublishablePlatform = useMemo(() => {
    if (requestedPlatform) return requestedPlatform;
    if (!result) return "youtube";
    const def = getClipperFormatDef(result.formatId);
    return publishPlatformForFormat(def?.platform ?? "youtube") ?? "youtube";
  }, [requestedPlatform, result]);

  const platformLabel = PLATFORM_LABELS[platform];
  const isTikTok = platform === "tiktok";

  const defaultTitle = useMemo(() => {
    if (!result) return "";
    const base = sourceFileName?.replace(/\.[^.]+$/, "") || "Clip";
    return `${base} — Clip ${result.clipIndex + 1} (${result.label})`;
  }, [result, sourceFileName]);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(defaultTitle);
    setDescription("");
    setPrivacyStatus("private");
    setUploadProgress(0);
    setUploadPhase("uploading");
    setWatchUrl(null);
    setIsPublishing(false);
    setTikTokPrivacy("");
    setAllowComment(false);
    setAllowDuet(false);
    setAllowStitch(false);
    setBrandContent(false);
    setBrandOrganic(false);
    setIsAigc(false);
    setMusicUsageConfirmed(false);
    setTikTokError(null);
  }, [isOpen, defaultTitle]);

  useEffect(() => {
    if (!isOpen || !isTikTok || !defaultConnected) return;
    let cancelled = false;
    void socialAuthService.getTikTokCreatorInfo()
      .then((creator) => { if (!cancelled) setTikTokCreator(creator); })
      .catch((error: unknown) => {
        if (!cancelled) setTikTokError(error instanceof Error ? error.message : "Could not load TikTok account settings.");
      });
    return () => { cancelled = true; };
  }, [isOpen, isTikTok, defaultConnected]);

  const handlePublish = async () => {
    if (!result || !title.trim()) return;

    if (!defaultConnected) {
      onRequestConnect(platform);
      return;
    }

    const video = await resolveClipperExportUploadFile(result);
    if (!video) {
      appToast.error("Upload failed", "Could not read the exported video file.");
      return;
    }

    setIsPublishing(true);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      let response: {
        jobId: string;
        status: string;
        watchUrl?: string;
        externalId?: string;
      };

      if (isTikTok) {
        if (!tiktokCreator?.canPost || !tiktokPrivacy || !musicUsageConfirmed) {
          throw new Error(tiktokCreator?.blockerMessage || "Choose TikTok privacy and confirm Music Usage before publishing.");
        }
        const durationSeconds = await getPreciseVideoDuration(video);
        if (tiktokCreator.maxVideoPostDurationSec && durationSeconds > tiktokCreator.maxVideoPostDurationSec) {
          throw new Error(`This TikTok account allows videos up to ${tiktokCreator.maxVideoPostDurationSec} seconds.`);
        }
        response = await socialAuthService.publishClipperToTikTok({
          projectId,
          exportId: result.id,
          video,
          clipIndex: result.clipIndex,
          formatId: result.formatId,
          options: {
            caption: title.trim(),
            privacyLevel: tiktokPrivacy,
            allowComment,
            allowDuet,
            allowStitch,
            brandContent,
            brandOrganic,
            isAigc,
            musicUsageConfirmed,
            durationSeconds,
          },
          onUploadProgress: setUploadProgress,
          onUploadPhaseChange: setUploadPhase,
        });
      } else if (platform === "youtube" && oauthFlowForPlatform(platform) === "youtube") {
        const yt = await youtubeAuthService.publishClipperExport({
          projectId,
          exportId: result.id,
          video,
          clipIndex: result.clipIndex,
          formatId: result.formatId,
          title: title.trim(),
          description: description.trim() || undefined,
          privacyStatus,
          expectedFileSize: result.fileSize,
          onUploadProgress: setUploadProgress,
          onUploadPhaseChange: setUploadPhase,
        });
        response = {
          jobId: yt.jobId,
          status: yt.status,
          watchUrl: yt.watchUrl,
          externalId: yt.youtubeVideoId,
        };
      } else {
        response = await socialAuthService.publishClipperExport({
          platform,
          projectId,
          exportId: result.id,
          video,
          clipIndex: result.clipIndex,
          formatId: result.formatId,
          title: title.trim(),
          description: description.trim() || undefined,
          privacyStatus,
          expectedFileSize: result.fileSize,
          onUploadProgress: setUploadProgress,
          onUploadPhaseChange: setUploadPhase,
        });

        if (response.status === "processing") {
          setUploadPhase("publishing");
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
      }

      if (response.watchUrl) {
        setWatchUrl(response.watchUrl);
      }

      if (response.status === "processing") {
        appToast.success("TikTok is processing", "Your post will be updated when TikTok finishes processing it.");
      } else {
        appToast.success("Published", `Your clip is now on ${platformLabel}.`);
      }
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ||
        (error instanceof Error ? error.message : `${platformLabel} upload failed`);
      appToast.error("Publish failed", message);
    } finally {
      setIsPublishing(false);
    }
  };

  return {
    platform,
    platformLabel,
    isTikTok,
    title,
    setTitle,
    description,
    setDescription,
    privacyStatus,
    setPrivacyStatus,
    isPublishing,
    uploadProgress,
    uploadPhase,
    watchUrl,
    tiktokCreator,
    tiktokPrivacy,
    setTikTokPrivacy,
    allowComment,
    setAllowComment,
    allowDuet,
    setAllowDuet,
    allowStitch,
    setAllowStitch,
    brandContent,
    setBrandContent,
    brandOrganic,
    setBrandOrganic,
    isAigc,
    setIsAigc,
    musicUsageConfirmed,
    setMusicUsageConfirmed,
    tiktokError,
    handlePublish,
    submitDisabled: !result || !title.trim() || (isTikTok && (!tiktokPrivacy || !musicUsageConfirmed || !tiktokCreator?.canPost)),
  };
}
