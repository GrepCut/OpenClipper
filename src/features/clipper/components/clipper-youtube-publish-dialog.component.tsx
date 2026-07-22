import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Progress,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Youtube, Instagram, Facebook, Linkedin } from "lucide-react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";
import { getClipperFormatDef } from "../shared/formats.util";
import {
  socialAuthService,
  publishPlatformForFormat,
  oauthFlowForPlatform,
  type SocialPrivacyStatus,
  type SocialPublishablePlatform,
  type TikTokCreatorInfo,
  type TikTokPrivacyLevel,
} from "../../../services/social-auth.service";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import { appToast } from "../../../shared/utils/toast.service";
import { resolveClipperExportUploadFile } from "../persistence/resolve-export-upload-file.util";
import { getPreciseVideoDuration } from "../lib/media/get-precise-video-duration.util";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";

interface ClipperSocialPublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  result: ClipperFormatResult | null;
  sourceFileName: string | null;
  /** Connection state for the resolved publish platform */
  defaultConnected: boolean;
  accountLabel: string | null;
  publishPlatform?: SocialPublishablePlatform;
  onRequestConnect: (platform: SocialPublishablePlatform) => void;
}

const PRIVACY_OPTIONS: { value: SocialPrivacyStatus; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

const PLATFORM_LABELS: Record<SocialPublishablePlatform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
};

function PlatformIcon({ platform }: { platform: SocialPublishablePlatform }) {
  switch (platform) {
    case "youtube":
      return <Youtube size={20} color="#FF0000" />;
    case "instagram":
      return <Instagram size={20} />;
    case "facebook":
      return <Facebook size={20} />;
    case "linkedin":
      return <Linkedin size={20} />;
    case "x":
      return <ClipperPlatformIcon platform="twitter" size={20} />;
    default:
      return <Youtube size={20} />;
  }
}

export const ClipperSocialPublishDialog: React.FC<
  ClipperSocialPublishDialogProps
> = ({
  isOpen,
  onClose,
  projectId,
  result,
  sourceFileName,
  defaultConnected,
  accountLabel,
  publishPlatform: requestedPlatform,
  onRequestConnect,
}) => {
  const { theme } = useClipperUi();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] =
    useState<SocialPrivacyStatus>("private");
  const [isPublishing, setIsPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "publishing">(
    "uploading",
  );
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
        // Keep legacy YouTube endpoint for existing Google token flow.
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

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Publish to ${platformLabel}`}
      size="md"
      isLoading={isPublishing}
      closeOnOverlayClick={!isPublishing}
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={() => void handlePublish()}
          submitText={defaultConnected ? "Publish" : `Connect ${platformLabel}`}
          isLoading={isPublishing}
          submitDisabled={!result || !title.trim() || (isTikTok && (!tiktokPrivacy || !musicUsageConfirmed || !tiktokCreator?.canPost))}
        />
      }
    >
      <VStack align="stretch" gap={4}>
        <HStack
          gap={3}
          p={3}
          borderRadius="xl"
          bg={theme.surface.subtle}
          border="1px solid"
          borderColor={theme.surface.hover}
        >
          <Box>
            <PlatformIcon platform={platform} />
          </Box>
          <Box flex={1}>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
              {defaultConnected
                ? accountLabel
                  ? `Connected: ${accountLabel}`
                  : `${platformLabel} connected`
                : `${platformLabel} not connected`}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              {defaultConnected
                ? "Upload uses your linked account."
                : "Connect your account before publishing."}
            </Text>
          </Box>
          {!defaultConnected ? (
            <Button
              size="sm"
              variant="outline"
              borderRadius="lg"
              onClick={() => onRequestConnect(platform)}
            >
              Connect
            </Button>
          ) : null}
        </HStack>

        <Box>
          <Text fontSize="sm" mb={2} color={theme.text.distinct}>
            {isTikTok ? "Caption" : "Title"}
          </Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            borderRadius="xl"
            bg={theme.surface.subtle}
            borderColor={theme.surface.borderStrong}
            color={theme.text.primary}
            disabled={isPublishing}
          />
        </Box>

        {!isTikTok ? <Box>
          <Text fontSize="sm" mb={2} color={theme.text.distinct}>
            Description
          </Text>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            borderRadius="xl"
            bg={theme.surface.subtle}
            borderColor={theme.surface.borderStrong}
            color={theme.text.primary}
            disabled={isPublishing}
          />
        </Box> : null}

        {isTikTok ? (
          <VStack align="stretch" gap={3}>
            <Box p={3} borderRadius="xl" bg={theme.surface.subtle}>
              <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                {tiktokCreator?.nickname || "TikTok account"}
              </Text>
              <Text fontSize="xs" color={theme.text.muted}>
                {tiktokCreator?.username ? `@${tiktokCreator.username}` : "Loading current TikTok posting settings…"}
              </Text>
              {tiktokError || (!tiktokCreator?.canPost && tiktokCreator?.blockerMessage) ? (
                <Text mt={2} fontSize="xs" color={theme.status.error}>
                  {tiktokError || tiktokCreator?.blockerMessage}
                </Text>
              ) : null}
            </Box>

            {result?.previewUrl ? (
              <video controls src={result.previewUrl} style={{ width: "100%", borderRadius: "12px" }} />
            ) : null}

            <Box>
              <Text fontSize="sm" mb={2} color={theme.text.distinct}>Privacy (required)</Text>
              <HStack gap={2} flexWrap="wrap">
                {(tiktokCreator?.privacyLevelOptions ?? []).map((option) => (
                  <Button key={option} size="sm" variant={tiktokPrivacy === option ? "solid" : "outline"}
                    onClick={() => setTikTokPrivacy(option)} disabled={isPublishing}>
                    {option.replaceAll("_", " ")}
                  </Button>
                ))}
              </HStack>
            </Box>

            <Box>
              <Text fontSize="sm" mb={2} color={theme.text.distinct}>Allow interactions</Text>
              <HStack gap={2} flexWrap="wrap">
                <Button size="sm" variant={allowComment ? "solid" : "outline"} onClick={() => setAllowComment((v) => !v)} disabled={isPublishing || Boolean(tiktokCreator?.commentDisabled)}>Comments</Button>
                <Button size="sm" variant={allowDuet ? "solid" : "outline"} onClick={() => setAllowDuet((v) => !v)} disabled={isPublishing || Boolean(tiktokCreator?.duetDisabled)}>Duet</Button>
                <Button size="sm" variant={allowStitch ? "solid" : "outline"} onClick={() => setAllowStitch((v) => !v)} disabled={isPublishing || Boolean(tiktokCreator?.stitchDisabled)}>Stitch</Button>
              </HStack>
            </Box>

            <Box>
              <Text fontSize="sm" mb={2} color={theme.text.distinct}>Content declarations</Text>
              <HStack gap={2} flexWrap="wrap">
                <Button size="sm" variant={isAigc ? "solid" : "outline"} onClick={() => setIsAigc((v) => !v)} disabled={isPublishing}>AI-generated content</Button>
                <Button size="sm" variant={brandContent ? "solid" : "outline"} onClick={() => setBrandContent((v) => !v)} disabled={isPublishing}>Branded content</Button>
                <Button size="sm" variant={brandOrganic ? "solid" : "outline"} onClick={() => setBrandOrganic((v) => !v)} disabled={isPublishing}>Your brand</Button>
              </HStack>
            </Box>

            <Button size="sm" variant={musicUsageConfirmed ? "solid" : "outline"}
              onClick={() => setMusicUsageConfirmed((v) => !v)} disabled={isPublishing}>
              By posting, I agree to TikTok&apos;s Music Usage Confirmation
            </Button>
          </VStack>
        ) : null}

        {platform === "youtube" ? (
          <Box>
            <Text fontSize="sm" mb={2} color={theme.text.distinct}>
              Privacy
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {PRIVACY_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  borderRadius="xl"
                  variant={privacyStatus === option.value ? "solid" : "outline"}
                  bg={
                    privacyStatus === option.value
                      ? clipperTheme.accent
                      : "transparent"
                  }
                  color={theme.text.primary}
                  borderColor={theme.surface.elevated}
                  onClick={() => setPrivacyStatus(option.value)}
                  disabled={isPublishing}
                >
                  {option.label}
                </Button>
              ))}
            </HStack>
          </Box>
        ) : null}

        {isPublishing ? (
          <Box>
            <Text fontSize="xs" mb={2} color={theme.text.muted}>
              {uploadPhase === "uploading"
                ? `Uploading video… ${Math.round(uploadProgress * 100)}%`
                : `Publishing to ${platformLabel}…`}
            </Text>
            <Progress.Root
              value={uploadPhase === "uploading" ? uploadProgress * 100 : null}
              max={100}
            >
              <Progress.Track borderRadius="full" bg={theme.surface.hover}>
                <Progress.Range bg={clipperTheme.accent} />
              </Progress.Track>
            </Progress.Root>
          </Box>
        ) : null}

        {watchUrl ? (
          <Box
            p={3}
            borderRadius="xl"
            bg={`rgba(${clipperTheme.accentTintRgb},0.12)`}
            border={`1px solid ${clipperTheme.accentGlow}`}
          >
            <Text fontSize="sm" color={theme.text.primary} mb={2}>
              Published successfully.
            </Text>
            <Box asChild>
              <a href={watchUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  size="sm"
                  borderRadius="xl"
                  bg={clipperTheme.accent}
                  color={theme.text.onBrand}
                >
                  Open on {platformLabel}
                </Button>
              </a>
            </Box>
          </Box>
        ) : null}
      </VStack>
    </StyledModal>
  );
};
