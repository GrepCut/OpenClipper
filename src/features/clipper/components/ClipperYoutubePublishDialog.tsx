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
import { Youtube } from "lucide-react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/StyledModal";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import type { ClipperFormatResult } from "../shared/state";
import type { YoutubePrivacyStatus } from "../../../services/youtubeAuth.service";
import { youtubeAuthService } from "../../../services/youtubeAuth.service";
import { appToast } from "../../../shared/utils/toast.service";
import { logYoutubeDebug, logYoutubeError } from "../shared/youtube-debug";
import { resolveClipperExportUploadFile } from "../persistence/resolve-export-upload-file";

interface ClipperYoutubePublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  result: ClipperFormatResult | null;
  sourceFileName: string | null;
  defaultConnected: boolean;
  channelTitle: string | null;
  onRequestConnect: () => void;
}

const PRIVACY_OPTIONS: { value: YoutubePrivacyStatus; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

export const ClipperYoutubePublishDialog: React.FC<
  ClipperYoutubePublishDialogProps
> = ({
  isOpen,
  onClose,
  projectId,
  result,
  sourceFileName,
  defaultConnected,
  channelTitle,
  onRequestConnect,
}) => {
  const { theme } = useClipperUi();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] =
    useState<YoutubePrivacyStatus>("private");
  const [isPublishing, setIsPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "publishing">("uploading");
  const [watchUrl, setWatchUrl] = useState<string | null>(null);

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
  }, [isOpen, defaultTitle]);

  const handlePublish = async () => {
    if (!result || !title.trim()) return;

    if (!defaultConnected) {
      logYoutubeDebug("ClipperYoutubePublishDialog: not connected, requesting connect", {
        projectId,
        clipIndex: result.clipIndex,
        formatId: result.formatId,
      });
      onRequestConnect();
      return;
    }

    const video = await resolveClipperExportUploadFile(result);
    if (!video) {
      logYoutubeError("ClipperYoutubePublishDialog: could not resolve video file", {
        result,
      });
      appToast.error("Upload failed", "Could not read the exported video file.");
      return;
    }

    logYoutubeDebug("ClipperYoutubePublishDialog: starting publish", {
      projectId,
      clipIndex: result.clipIndex,
      formatId: result.formatId,
      title: title.trim(),
      privacyStatus,
      videoSize: video.size,
      manifestFileSize: result.fileSize,
      videoName: video.name,
      channelTitle,
    });

    setIsPublishing(true);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const response = await youtubeAuthService.publishClipperExport({
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

      logYoutubeDebug("ClipperYoutubePublishDialog: publish response", response);

      if (response.watchUrl) {
        setWatchUrl(response.watchUrl);
      }

      appToast.success("Published", "Your clip is now on YouTube.");
    } catch (error: unknown) {
      logYoutubeError("ClipperYoutubePublishDialog: publish failed", {
        error,
        responseData: (error as { response?: { data?: unknown } })?.response?.data,
        status: (error as { response?: { status?: number } })?.response?.status,
      });
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ||
        (error instanceof Error ? error.message : "YouTube upload failed");
      appToast.error("Publish failed", message);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title="Publish to YouTube"
      size="md"
      isLoading={isPublishing}
      closeOnOverlayClick={!isPublishing}
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={() => void handlePublish()}
          submitText={defaultConnected ? "Publish" : "Connect YouTube"}
          isLoading={isPublishing}
          submitDisabled={!result || !title.trim()}
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
          <Box color="#FF0000">
            <Youtube size={20} />
          </Box>
          <Box flex={1}>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
              {defaultConnected
                ? channelTitle
                  ? `Connected: ${channelTitle}`
                  : "YouTube connected"
                : "YouTube not connected"}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              {defaultConnected
                ? "Upload uses your linked Google account."
                : "Connect your channel before publishing."}
            </Text>
          </Box>
          {!defaultConnected ? (
            <Button
              size="sm"
              variant="outline"
              borderRadius="lg"
              onClick={onRequestConnect}
            >
              Connect
            </Button>
          ) : null}
        </HStack>

        <Box>
          <Text fontSize="sm" mb={2} color={theme.text.distinct}>
            Title
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

        <Box>
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
        </Box>

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

        {isPublishing ? (
          <Box>
            <Text fontSize="xs" mb={2} color={theme.text.muted}>
              {uploadPhase === "uploading"
                ? `Uploading video… ${Math.round(uploadProgress * 100)}%`
                : "Publishing to YouTube…"}
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
            <Box
              asChild
            >
              <a href={watchUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  size="sm"
                  borderRadius="xl"
                  bg={clipperTheme.accent}
                  color={theme.text.onBrand}
                >
                  Open on YouTube
                </Button>
              </a>
            </Box>
          </Box>
        ) : null}
      </VStack>
    </StyledModal>
  );
};
