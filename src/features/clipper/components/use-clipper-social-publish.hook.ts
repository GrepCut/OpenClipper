import { useEffect, useMemo, useRef, useState } from "react";
import { getClipperFormatDef } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import {
  publishPlatformForFormat,
  type SocialConnectionSummary,
  type SocialPrivacyStatus,
  type SocialPublishablePlatform,
} from "../../../services/social-auth.service";
import { appToast } from "../../../shared/utils/toast.service";
import { resolveClipperExportUploadFile } from "../persistence/resolve-export-upload-file.util";
import {
  isYoutubeReauthRequired,
  normalizePublishStatus,
  persistPublishRecord,
  publishErrorMessage,
  sanitizeSocialWatchUrl,
} from "../shared/clipper-social-publish-record.util";
import { runClipperSocialPublish } from "../shared/run-clipper-social-publish.util";
import type { ClipperExportPublishRecord } from "../persistence/clipper-export-db-api.util";
import { PLATFORM_LABELS } from "./clipper-social-publish-dialog.constants";
import { usePublishUploadStallWarning } from "./use-publish-upload-stall-warning.hook";
import { useClipperTikTokPublishForm } from "./use-clipper-tiktok-publish-form.hook";

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
  onPublishStart,
  onPublishError,
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
  onPublishStart?: () => void;
  onPublishError?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState<SocialPrivacyStatus>("private");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [didSucceed, setDidSucceed] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "publishing">("uploading");
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const sessionBusyRef = useRef(false);
  sessionBusyRef.current = isPublishing || didSucceed;

  const platform: SocialPublishablePlatform = useMemo(() => {
    if (requestedPlatform) return requestedPlatform;
    if (!result) return "youtube";
    const def = getClipperFormatDef(result.formatId);
    return publishPlatformForFormat(def?.platform ?? "youtube") ?? "youtube";
  }, [requestedPlatform, result]);

  const platformLabel = PLATFORM_LABELS[platform];
  const isTikTok = platform === "tiktok";
  const isYoutube = platform === "youtube";
  const usesPublishModals = isYoutube || isTikTok;
  const activeConnectionId = selectedConnectionId ?? accountConnections[0]?.id ?? null;
  const tiktok = useClipperTikTokPublishForm({
    isOpen,
    enabled: isTikTok,
    defaultConnected,
    connectionId: activeConnectionId,
    resetAllowed: !sessionBusyRef.current,
  });

  const defaultTitle = useMemo(() => {
    if (!result) return "";
    const socialTitle = result.socialTitle?.trim();
    if (socialTitle) return socialTitle;
    const base = sourceFileName?.replace(/\.[^.]+$/, "") || "Clip";
    return `${base}: Clip ${result.clipIndex + 1} (${result.label})`;
  }, [result, sourceFileName]);

  const defaultDescription = useMemo(() => {
    if (!result) return "";
    return result.socialDescription?.trim() ?? "";
  }, [result]);

  usePublishUploadStallWarning(isPublishing, uploadPhase, uploadProgress);

  useEffect(() => {
    if (!isOpen) {
      setIsPublishing(false);
      setDidSucceed(false);
      setWatchUrl(null);
      setUploadProgress(0);
      setUploadPhase("uploading");
      return;
    }
    if (sessionBusyRef.current) return;
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setPrivacyStatus("private");
    setSelectedConnectionId(accountConnections[0]?.id ?? null);
  }, [isOpen, defaultTitle, defaultDescription, accountConnections]);

  const handlePublish = async () => {
    if (isPublishing || !result || !title.trim()) return;
    if (!defaultConnected) {
      onRequestConnect(platform);
      return;
    }
    if (!activeConnectionId) {
      appToast.error("No account selected", `Connect a ${platformLabel} account before publishing.`);
      return;
    }
    if (isTikTok && !tiktok.tiktokReady) {
      appToast.error(
        "Publish failed",
        tiktok.tiktokCreator?.blockerMessage
          || "Choose TikTok privacy, complete content disclosure, and confirm Music Usage before publishing.",
      );
      return;
    }

    const video = await resolveClipperExportUploadFile(result);
    if (!video) {
      appToast.error("Upload failed", "Could not read the exported video file.");
      return;
    }

    onPublishStart?.();
    setDidSucceed(false);
    setWatchUrl(null);
    setIsPublishing(true);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const response = await runClipperSocialPublish({
        platform,
        platformLabel,
        projectId,
        exportId: result.id,
        connectionId: activeConnectionId,
        video,
        clipIndex: result.clipIndex,
        formatId: result.formatId,
        title: title.trim(),
        description: description.trim(),
        privacyStatus,
        expectedFileSize: result.fileSize,
        tiktokCreator: tiktok.tiktokCreator,
        tiktokOptions: isTikTok && tiktok.tiktokPrivacy
          ? {
              privacyLevel: tiktok.tiktokPrivacy,
              allowComment: tiktok.allowComment,
              allowDuet: tiktok.allowDuet,
              allowStitch: tiktok.allowStitch,
              brandContent: tiktok.brandContent,
              brandOrganic: tiktok.brandOrganic,
              isAigc: tiktok.isAigc,
              musicUsageConfirmed: tiktok.musicUsageConfirmed,
            }
          : undefined,
        onUploadProgress: setUploadProgress,
        onUploadPhaseChange: setUploadPhase,
      });

      if (response.watchUrl) setWatchUrl(sanitizeSocialWatchUrl(response.watchUrl) ?? null);

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

      if (
        usesPublishModals
        && (publishStatus === "succeeded" || response.status === "processing")
      ) {
        setDidSucceed(true);
        return;
      }

      if (response.status === "processing") {
        appToast.success("Processing", `${platformLabel} is finishing your post. We'll update when it's ready.`);
      } else {
        appToast.success("Published", `Your clip is now on ${platformLabel}.`);
      }
    } catch (error: unknown) {
      onPublishError?.();
      const message = publishErrorMessage(error, `${platformLabel} upload failed`);
      await persistPublishRecord(
        { exportId: result.id, platform, status: "failed", errorMessage: message },
        onPublishComplete,
      );
      if (isYoutube && isYoutubeReauthRequired(error, message)) {
        appToast.error("YouTube session expired", "Reconnect YouTube to continue publishing.");
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
    isYoutube,
    usesPublishModals,
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
    didSucceed,
    uploadProgress,
    uploadPhase,
    watchUrl,
    ...tiktok,
    handlePublish,
    submitDisabled: isPublishing || !result || !title.trim() || (isTikTok && !tiktok.tiktokReady),
  };
}

export type ClipperSocialPublishController = ReturnType<typeof useClipperSocialPublish>;
