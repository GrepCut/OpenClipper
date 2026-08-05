import { useEffect, useMemo, useRef, useState } from "react";
import { getClipperFormatDef } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import {
  oauthFlowForPlatform,
  publishPlatformForFormat,
  socialAuthService,
  type SocialConnectionSummary,
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
import { isTauri } from "../../../shared/utils/platform.util";
import {
  upsertClipperExportPublish,
  type ClipperExportPublishRecord,
} from "../persistence/clipper-export-db-api.util";

const UPLOAD_STALL_WARNING_MS = 30_000;

function isYoutubeReauthRequired(error: unknown, message: string): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) {
    return true;
  }

  return /authorization expired|connect youtube again/i.test(message);
}

function normalizePublishStatus(
  status: string,
  watchUrl?: string,
): ClipperExportPublishRecord["status"] {
  if (status === "failed") return "failed";
  if (status === "succeeded" || watchUrl) return "succeeded";
  return "pending";
}

async function persistPublishRecord(
  input: {
    exportId: string;
    platform: SocialPublishablePlatform;
    status: ClipperExportPublishRecord["status"];
    jobId?: string;
    watchUrl?: string;
    externalId?: string;
    errorMessage?: string;
  },
  onComplete?: (record: ClipperExportPublishRecord) => void,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const record = await upsertClipperExportPublish({
      exportId: input.exportId,
      platform: input.platform,
      status: input.status,
      jobId: input.jobId,
      watchUrl: input.watchUrl,
      externalId: input.externalId,
      errorMessage: input.errorMessage,
    });
    onComplete?.(record);
  } catch {
    // Non-blocking — publish API already succeeded or failed
  }
}

export function useClipperSocialPublish({
  isOpen,
  result,
  sourceFileName,
  defaultConnected,
  accountConnections,
  requestedPlatform,
  projectId,
  onRequestConnect,
  onPublishComplete,
}: {
  isOpen: boolean;
  result: ClipperFormatResult | null;
  sourceFileName: string | null;
  defaultConnected: boolean;
  accountConnections: SocialConnectionSummary[];
  requestedPlatform?: SocialPublishablePlatform;
  projectId: string;
  onRequestConnect: (platform: SocialPublishablePlatform) => void;
  onPublishComplete?: (record: ClipperExportPublishRecord) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState<SocialPrivacyStatus>("private");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
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
  const lastUploadProgressRef = useRef(0);
  const lastUploadProgressAtRef = useRef(0);
  const uploadStallWarnedRef = useRef(false);

  const platform: SocialPublishablePlatform = useMemo(() => {
    if (requestedPlatform) return requestedPlatform;
    if (!result) return "youtube";
    const def = getClipperFormatDef(result.formatId);
    return publishPlatformForFormat(def?.platform ?? "youtube") ?? "youtube";
  }, [requestedPlatform, result]);

  const platformLabel = PLATFORM_LABELS[platform];
  const isTikTok = platform === "tiktok";
  const activeConnectionId = selectedConnectionId ?? accountConnections[0]?.id ?? null;

  const defaultTitle = useMemo(() => {
    if (!result) return "";
    const socialTitle = result.socialTitle?.trim();
    if (socialTitle) return socialTitle;
    const base = sourceFileName?.replace(/\.[^.]+$/, "") || "Clip";
    return `${base} — Clip ${result.clipIndex + 1} (${result.label})`;
  }, [result, sourceFileName]);

  const defaultDescription = useMemo(() => {
    if (!result) return "";
    return result.socialDescription?.trim() ?? "";
  }, [result]);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setPrivacyStatus("private");
    setSelectedConnectionId(accountConnections[0]?.id ?? null);
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
  }, [isOpen, defaultTitle, defaultDescription, accountConnections]);

  useEffect(() => {
    if (!isOpen || !isTikTok || !defaultConnected || !activeConnectionId) return;
    let cancelled = false;
    void socialAuthService.getTikTokCreatorInfo(activeConnectionId)
      .then((creator) => { if (!cancelled) setTikTokCreator(creator); })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTikTokError(error instanceof Error ? error.message : "Could not load TikTok account settings.");
        }
      });
    return () => { cancelled = true; };
  }, [isOpen, isTikTok, defaultConnected, activeConnectionId]);

  useEffect(() => {
    if (!isPublishing) {
      uploadStallWarnedRef.current = false;
      return;
    }

    lastUploadProgressRef.current = uploadProgress;
    lastUploadProgressAtRef.current = Date.now();
    uploadStallWarnedRef.current = false;
  }, [isPublishing]);

  useEffect(() => {
    if (!isPublishing || uploadPhase !== "uploading") {
      return;
    }

    const interval = window.setInterval(() => {
      if (uploadProgress !== lastUploadProgressRef.current) {
        lastUploadProgressRef.current = uploadProgress;
        lastUploadProgressAtRef.current = Date.now();
        uploadStallWarnedRef.current = false;
        return;
      }

      if (
        uploadProgress < 1
        && !uploadStallWarnedRef.current
        && Date.now() - lastUploadProgressAtRef.current >= UPLOAD_STALL_WARNING_MS
      ) {
        uploadStallWarnedRef.current = true;
        appToast.info(
          "Upload still in progress",
          "Your video is still uploading. Large clips can take a few minutes.",
        );
      }
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [isPublishing, uploadPhase, uploadProgress]);

  const handlePublish = async () => {
    if (!result || !title.trim()) return;

    if (!defaultConnected) {
      onRequestConnect(platform);
      return;
    }

    if (!activeConnectionId) {
      appToast.error("No account selected", `Connect a ${platformLabel} account before publishing.`);
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
          connectionId: activeConnectionId,
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
          connectionId: activeConnectionId,
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
          connectionId: activeConnectionId,
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

      const publishStatus = normalizePublishStatus(response.status, response.watchUrl);
      await persistPublishRecord(
        {
          exportId: result.id,
          platform,
          status: publishStatus,
          jobId: response.jobId,
          watchUrl: response.watchUrl,
          externalId: response.externalId,
        },
        onPublishComplete,
      );

      if (response.status === "processing") {
        appToast.success("Processing", `${platformLabel} is finishing your post. We'll update when it's ready.`);
      } else {
        appToast.success("Published", `Your clip is now on ${platformLabel}.`);
      }
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ||
        (error instanceof Error ? error.message : `${platformLabel} upload failed`);
      if (result) {
        await persistPublishRecord(
          {
            exportId: result.id,
            platform,
            status: "failed",
            errorMessage: message,
          },
          onPublishComplete,
        );
      }

      if (platform === "youtube" && isYoutubeReauthRequired(error, message)) {
        appToast.error(
          "YouTube session expired",
          "Reconnect YouTube to continue publishing.",
        );
        onRequestConnect("youtube");
        return;
      }

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
    selectedConnectionId: activeConnectionId,
    setSelectedConnectionId,
    accountConnections,
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
    submitDisabled:
      !result ||
      !title.trim() ||
      (isTikTok && (!tiktokPrivacy || !musicUsageConfirmed || !tiktokCreator?.canPost)),
  };
}
