import { useEffect, useId, useRef, useState } from "react";
import { Box, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { CheckCircle2, Youtube } from "lucide-react";
import { MainButton } from "../../../shared/components/buttons/main-button.component";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { ThemedCheckbox } from "../../../shared/components/ui/themed-checkbox.component";
import { ThemedInput } from "../../../shared/components/ui/themed-input.component";
import { openExternalUrl } from "../../../shared/utils/open-external-url.util";
import {
  downloadYouTubeSource,
  getYouTubeImportVersion,
  isLooseUrl,
  openDownloadedYouTubeSource,
  YOUTUBE_IMPORT_TERMS,
  type DownloadedYouTubeSource,
  type YouTubeImportProgress,
} from "../persistence/youtube-import.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperProgressBar } from "./clipper-progress-bar.component";
import { ClipperSourceRevealButton } from "./clipper-source-reveal-button.component";
import { ClipperUpload } from "./clipper-upload.component";

const progressTitles: Record<YouTubeImportProgress["phase"], string> = {
  resolve: "Downloading video",
  download: "Downloading video",
  prepare: "Preparing video",
};

const progressLabels: Record<YouTubeImportProgress["phase"], string> = {
  resolve: "Checking the YouTube video…",
  download: "Downloading to your Downloads folder…",
  prepare: "Preparing the video for editing…",
};

/**
 * The parent owns the mode and import progress so it can update its back button.
 * Pass stable setters for both.
 */
export function ClipperSourcePicker({
  projectId, onFile, onYouTubeFile, fill = false, mode, onModeChange, progress, setProgress,
}: {
  projectId: string;
  onFile: (file: File) => void;
  onYouTubeFile: (file: File, signal: AbortSignal) => Promise<void>;
  fill?: boolean;
  mode: "file" | "youtube";
  onModeChange: (mode: "file" | "youtube") => void;
  progress: YouTubeImportProgress | null;
  setProgress: (progress: YouTubeImportProgress | null) => void;
}) {
  const { theme } = useClipperUi();
  const linkId = useId();
  const titleId = useId();
  const controller = useRef<AbortController | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [downloaded, setDownloaded] = useState<DownloadedYouTubeSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void getYouTubeImportVersion().then((version) => { if (current) setVersion(version); });
    return () => {
      current = false;
      const operation = controller.current;
      if (operation) {
        controller.current = null;
        operation.abort();
        setProgress(null);
      }
    };
  }, [setProgress]);

  // Leaving this picker (unmount) returns the parent to the file screen.
  useEffect(() => () => onModeChange("file"), [onModeChange]);

  useEffect(() => {
    if (mode === "file") {
      setError(null);
      setDownloaded(null);
    }
  }, [mode]);

  if (!version) return <ClipperUpload onFile={onFile} fill={fill} />;

  if (mode === "file") {
    return (
      <ClipperUpload onFile={onFile} fill={fill}>
        <VStack gap={3} pt={2}>
          <Text fontSize="xs" color={theme.text.muted} textTransform="uppercase" letterSpacing="0.08em">or</Text>
          <OutlinedActionButton type="button" startIcon={<Youtube size={18} />} onClick={() => onModeChange("youtube")}>
            Import from YouTube
          </OutlinedActionButton>
        </VStack>
      </ClipperUpload>
    );
  }

  const isActive = (operation: AbortController) =>
    controller.current === operation && !operation.signal.aborted;

  const reportProgress = (operation: AbortController, next: YouTubeImportProgress) => {
    if (isActive(operation)) setProgress(next);
  };

  const finishOperation = (operation: AbortController) => {
    if (controller.current !== operation) return;
    controller.current = null;
    setProgress(null);
  };

  const download = async () => {
    if (!version || !confirmed || controller.current) return;
    if (!isLooseUrl(url)) {
      setError("Enter a valid link.");
      return;
    }
    const operation = new AbortController();
    controller.current = operation;
    setError(null);
    setDownloaded(null);
    setProgress({ phase: "resolve", ratio: null });
    try {
      const result = await downloadYouTubeSource({
        projectId, version, url, rightsConfirmed: confirmed,
        signal: operation.signal,
        onProgress: (next) => reportProgress(operation, next),
      });
      if (isActive(operation)) setDownloaded(result);
    } catch (error) {
      if (isActive(operation) && !(error instanceof DOMException && error.name === "AbortError")) {
        setError(error instanceof Error ? error.message : "Could not import this YouTube video.");
      }
    } finally {
      finishOperation(operation);
    }
  };

  const continueWithDownloaded = async () => {
    if (!version || !downloaded || controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setError(null);
    setProgress({ phase: "prepare", ratio: null });
    try {
      await openDownloadedYouTubeSource({
        projectId,
        version,
        downloaded,
        signal: operation.signal,
        onProgress: (next) => reportProgress(operation, next),
        onSource: onYouTubeFile,
      });
    } catch (error) {
      if (isActive(operation) && !(error instanceof DOMException && error.name === "AbortError")) {
        setError(error instanceof Error ? error.message : "Could not open this YouTube video.");
      }
    } finally {
      finishOperation(operation);
    }
  };

  const primaryActionProps = {
    type: "submit" as const,
    h: "44px",
    px: 6,
    fontSize: "sm",
    fontWeight: "semibold",
    borderRadius: "full",
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    bg: "#000",
    color: "white",
    borderWidth: "1px",
    borderColor: theme.border.primary,
    _hover: {
      bg: "#15191F",
      borderColor: "rgba(255, 255, 255, 0.3)",
      transform: "translateY(-1px)",
      _disabled: { transform: "none", bg: "#000", borderColor: theme.border.primary },
    },
    _disabled: { opacity: 0.45, cursor: "not-allowed" },
  };

  const headerTitle = progress
    ? progressTitles[progress.phase]
    : downloaded
      ? "Download complete"
      : "Import from YouTube";
  const headerSubtitle = progress
    ? null
    : downloaded
      ? "Saved to your Downloads folder."
      : "The video is saved to your Downloads folder.";

  return (
    <VStack
      w="full" gap={4} justify="center"
      minH={fill ? { base: "calc(100dvh - 130px)", md: "calc(100dvh - 150px)" } : { base: "220px", md: "280px" }}
    >
      <Box
        as="section" aria-labelledby={titleId} w="full" maxW="620px"
        px={{ base: 4, md: 6 }} py={4} borderWidth="1px" borderColor={theme.surface.focus}
        borderRadius="2xl" bg={theme.surface.inset}
        data-sentry-block
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          void (downloaded ? continueWithDownloaded() : download());
        }}>
          <VStack align="stretch" gap={3}>
            <Box>
              <Text id={titleId} fontWeight="semibold" color={theme.text.primary}>{headerTitle}</Text>
              {headerSubtitle && (
                <Text fontSize="sm" color={theme.text.muted}>{headerSubtitle}</Text>
              )}
            </Box>

            {progress ? (
              <Box role="status">
                <ClipperProgressBar label={progressLabels[progress.phase]} value={progress.ratio} />
              </Box>
            ) : downloaded ? (
              <HStack
                role="status"
                gap={2.5}
                px={3}
                py={2.5}
                borderRadius="xl"
                bg={theme.surface.subtle}
                borderWidth="1px"
                borderColor={theme.border.secondary}
              >
                <Box color={theme.status.success} flexShrink={0}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                </Box>
                <Text fontSize="sm" color={theme.text.primary} lineClamp={2} title={downloaded.fileName}>
                  {downloaded.fileName}
                </Text>
              </HStack>
            ) : (
              <>
                <ThemedInput
                  id={linkId} type="url" aria-label="YouTube video link" placeholder="https://www.youtube.com/watch?v=…"
                  value={url} autoComplete="off" maxLength={2048} autoFocus
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setConfirmed(false);
                    setDownloaded(null);
                    setError(null);
                  }}
                />
                <ThemedCheckbox
                  checked={confirmed}
                  disabled={!isLooseUrl(url)}
                  onCheckedChange={setConfirmed}
                >
                  I confirm that I own this content or have permission to download and edit it, and that I can download it under YouTube’s terms and applicable law.
                </ThemedCheckbox>
              </>
            )}

            <HStack justify="space-between" flexWrap="wrap" gap={3}>
              <Link
                href={YOUTUBE_IMPORT_TERMS} color={theme.text.muted} fontSize="sm"
                textDecoration="underline" textUnderlineOffset="3px"
                transition="color 0.2s"
                _hover={{ color: theme.text.primary }}
                _focusVisible={{ outline: "2px solid", outlineColor: theme.text.primary, outlineOffset: "2px", borderRadius: "sm" }}
                onClick={(event) => {
                event.preventDefault();
                void openExternalUrl(YOUTUBE_IMPORT_TERMS).catch(() => {});
              }}>
                Open Clipper import terms
              </Link>
              {progress ? (
                <OutlinedActionButton type="button" onClick={() => controller.current?.abort()}>
                  Cancel import
                </OutlinedActionButton>
              ) : downloaded ? (
                <HStack gap={2} flexWrap="wrap">
                  <ClipperSourceRevealButton
                    path={downloaded.filePath}
                    verifiedDownloaded
                    h="44px"
                    borderRadius="full"
                  />
                  <MainButton {...primaryActionProps}>
                    Continue
                  </MainButton>
                </HStack>
              ) : (
                <MainButton {...primaryActionProps} disabled={!confirmed || !url.trim()}>
                  Download video
                </MainButton>
              )}
            </HStack>
            {error && <Text role="alert" color={theme.status.danger} fontSize="sm">{error}</Text>}
          </VStack>
        </form>
      </Box>
    </VStack>
  );
}
