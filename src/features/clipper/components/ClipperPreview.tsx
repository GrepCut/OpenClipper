import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, HStack, Slider, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { ListOrdered, Pause, Play } from "lucide-react";
import { OutlinedActionButton, getOutlinedActionSurfaceProps, OUTLINED_ACTION_BUTTON_SIZE_PROPS } from "../../../shared/components/buttons/OutlinedActionButton";
import { drawClipperPreviewFrame, formatNeedsFaceTracking, type ClipperFrameContext } from "../engine/frame-draw";
import {
  deriveCollageAspectEligibility,
  deriveTwoSpeakerRegions,
  filterRegionsWithEligibleAspects,
} from "../engine/collage";
import type { FaceDetectFrameSource } from "../engine/reframe";
import type { ClipperClipSegmentWindow } from "../engine/clip-segmentation";
import {
  findGapJumpTarget,
  localTimeToSourceTime,
  sourceTimeToLocalTime,
} from "../engine/clip-segment-time";
import { FrameCanvasCache } from "../lib/media/video-frame-effect";
import { ToolFaceDetectorService } from "../lib/media/face-detector";
import { clipperError, clipperLog } from "../shared/logger";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import type { ClipperSettings } from "../settings/settings";
import { CLIPPER_CARD_FRAME_HEIGHT, CLIPPER_FORMAT_DEFS, CLIPPER_HERO_PREVIEW_HEIGHT } from "../shared/formats";
import type { ClipperClipPreview, ClipperPipelineState, ClipSourceMode } from "../shared/state";
import type { ClipTranscriptEditOp } from "../engine/clip-transcript-edit";
import type {
  ClipperAiChatMessage,
  ClipperAiClipPickerModel,
} from "../persistence/ai-clip-api";
import { ClipperClipsSection } from "./ClipperClipsSection";
import { ClipperFormatCard } from "./ClipperFormatCard";
import { ClipperHorizontalCarousel } from "./ClipperHorizontalCarousel";
import { ClipperSettingsDrawer } from "./ClipperSettingsDrawer";

const CLIP_SOURCE_MODE_OPTIONS: Array<{ value: ClipSourceMode; label: string }> = [
  { value: "auto-parts", label: "Auto-parts" },
  { value: "ai", label: "Generate with LLM" },
];

const TOOLBAR_ACTION_BUTTON_PROPS = {
  ...OUTLINED_ACTION_BUTTON_SIZE_PROPS,
  h: "36px",
  minH: "36px",
  whiteSpace: "nowrap" as const,
};

function truncatePreviewUrl(url: string, maxLen = 80): string {
  if (url.length <= maxLen) return url;
  return `${url.slice(0, maxLen)}…`;
}

async function makePreviewFrameSource(video: HTMLVideoElement): Promise<FaceDetectFrameSource> {
  const frame = new VideoFrame(video, { timestamp: Math.round(video.currentTime * 1_000_000) });
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(frame);
  } catch {
    bitmap = undefined;
  }
  return {
    frame,
    bitmap,
    rotationDegrees: 0,
    release: () => {
      bitmap?.close();
      frame.close();
    },
  };
}

type VideoFrameCallbackCompat = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface ClipperTimelineProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  segments: ClipperClipSegmentWindow[];
  clipDuration: number;
  activeClipIndex: number;
}

/**
 * Oś czasu klipu z playheadem. Wydzielona i zmemoizowana, bo playhead
 * aktualizuje się co klatkę wideo (rAF podczas odtwarzania) — trzymanie go
 * w stanie rodzica re-renderowało cały subtree preview (selektor klipów,
 * karty formatów, panel ustawień) z częstotliwością klatek.
 */
const ClipperTimeline = React.memo(function ClipperTimeline({
  videoRef,
  segments,
  clipDuration,
  activeClipIndex,
}: ClipperTimelineProps) {
  const { theme } = useClipperUi();
  const [localPlayhead, setLocalPlayhead] = useState(() => Math.min(3, clipDuration * 0.15));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalPlayhead(Math.min(3, clipDuration * 0.15));
  }, [activeClipIndex, clipDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const sync = () => {
      setLocalPlayhead(
        Math.max(0, Math.min(clipDuration, sourceTimeToLocalTime(segments, video.currentTime))),
      );
    };
    const loop = () => {
      sync();
      rafRef.current = requestAnimationFrame(loop);
    };
    const start = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      sync();
    };

    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    video.addEventListener("seeked", sync);
    if (!video.paused && !video.ended) start();

    return () => {
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop);
      video.removeEventListener("seeked", sync);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [videoRef, segments, clipDuration, activeClipIndex]);

  const handleScrub = (localValue: number) => {
    const video = videoRef.current;
    if (!video) return;
    setLocalPlayhead(localValue);
    video.currentTime = localTimeToSourceTime(segments, localValue);
  };

  return (
    <VStack align="stretch" gap={2}>
      <Slider.Root
        min={0}
        max={clipDuration}
        step={0.05}
        value={[localPlayhead]}
        onValueChange={(d) => handleScrub(d.value[0] ?? 0)}
      >
        <Slider.Control>
          <Slider.Track bg={theme.surface.active} borderRadius="full">
            <Slider.Range bg={clipperTheme.accent} />
          </Slider.Track>
          <Slider.Thumb index={0} />
        </Slider.Control>
      </Slider.Root>
    </VStack>
  );
});

interface ClipperPlayOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeClipIndex: number;
  onTogglePlay: () => void;
}

/**
 * Półprzezroczysty przycisk play/pause na środku klipu hero.
 * Cała powierzchnia klipu jest klikalna (toggle), sam krążek jest
 * "lekko widoczny" — mocniejszy gdy zapauzowane, subtelny podczas odtwarzania.
 */
const ClipperPlayOverlay = React.memo(function ClipperPlayOverlay({
  videoRef,
  activeClipIndex,
  onTogglePlay,
}: ClipperPlayOverlayProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setIsPlaying(!video.paused && !video.ended);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    sync();
    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("ended", sync);
    };
  }, [videoRef, activeClipIndex]);

  return (
    <Box
      as="button"
      type="button"
      position="absolute"
      inset={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="transparent"
      border="none"
      cursor="pointer"
      zIndex={2}
      aria-label={isPlaying ? "Pause" : "Play"}
      onClick={onTogglePlay}
      _hover={{
        "& [data-play-overlay-btn]": { opacity: 1, transform: "scale(1.06)" },
      }}
    >
      <Box
        data-play-overlay-btn
        w="56px"
        h="56px"
        borderRadius="full"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="rgba(0, 0, 0, 0.45)"
        backdropFilter="blur(6px)"
        border="1px solid rgba(255, 255, 255, 0.25)"
        color="white"
        opacity={isPlaying ? 0.3 : 0.75}
        transition="opacity 0.2s ease, transform 0.2s ease"
      >
        {isPlaying ? (
          <Pause size={22} fill="currentColor" />
        ) : (
          <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
        )}
      </Box>
    </Box>
  );
});

interface ClipperPreviewProps {
  state: ClipperPipelineState;
  rangeTrimmedVideoUrl: string;
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onClipSourceModeChange: (mode: ClipSourceMode) => void;
  aiChatMessages: ClipperAiChatMessage[];
  aiChatLoading: boolean;
  aiChatError: string | null;
  aiChatThinking: string;
  aiChatProgressChars: number;
  aiChatModel: ClipperAiClipPickerModel;
  onAiChatModelChange: (model: ClipperAiClipPickerModel) => void;
  onSendAiChatMessage: (message: string, preset?: string) => void;
  onLoadAiChatHistory: () => void;
  onNewAiChat?: () => void;
  aiCurrentClipsJsonChars?: number;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
  settings: ClipperSettings;
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  getFrameContext: () => ClipperFrameContext | null;
  sourceFileName: string | null;
  isRendering?: boolean;
  exportCount?: number;
  onViewExports?: () => void;
  onOpenRenderQueue: () => void;
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  autoPartsSegmentLengthSec: import("../persistence/project-metadata").AutoPartsSegmentLengthSec;
  onAutoPartsSegmentLengthChange: (
    lengthSec: import("../persistence/project-metadata").AutoPartsSegmentLengthSec,
  ) => void;
  onResetAutoParts?: () => void;
  autoPartsResegmenting?: boolean;
  onEditClipTranscript?: (clipIndex: number, op: ClipTranscriptEditOp) => void;
  onUndoClipEdit?: () => void;
  onRedoClipEdit?: () => void;
  canUndoClipEdit?: boolean;
  canRedoClipEdit?: boolean;
  lastEditedTranscriptRange?: { clipIndex: number; startIdx: number; endIdx: number } | null;
}

export const ClipperPreview: React.FC<ClipperPreviewProps> = ({
  state,
  rangeTrimmedVideoUrl,
  clipPreviews,
  autoPartsClipPreviews,
  aiClipPreviews,
  clipSourceMode,
  activeClipIndex,
  onSelectClip,
  onClipSourceModeChange,
  aiChatMessages,
  aiChatLoading,
  aiChatError,
  aiChatThinking,
  aiChatProgressChars,
  aiChatModel,
  onAiChatModelChange,
  onSendAiChatMessage,
  onLoadAiChatHistory,
  onNewAiChat,
  aiCurrentClipsJsonChars,
  onDeleteAiClip,
  onDeleteAutoPartsClip,
  settings,
  onUpdateSettings,
  getFrameContext,
  sourceFileName,
  isRendering = false,
  exportCount = 0,
  onViewExports,
  onOpenRenderQueue,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  autoPartsSegmentLengthSec,
  onAutoPartsSegmentLengthChange,
  onResetAutoParts,
  autoPartsResegmenting,
  onEditClipTranscript,
  onUndoClipEdit,
  onRedoClipEdit,
  canUndoClipEdit,
  canRedoClipEdit,
  lastEditedTranscriptRange,
}) => {
  const { theme, outlineButton } = useClipperUi();
  const { open: settingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const rafRef = useRef<number | null>(null);
  const vfcIdRef = useRef<number | null>(null);
  const canvasCachesRef = useRef<Map<string, FrameCanvasCache>>(new Map());
  const firstFrameLoggedRef = useRef(false);
  const playAfterClipSelectRef = useRef(false);
  const pendingSeekSourceTimeRef = useRef<number | null>(null);
  const previewRegionRef = useRef<HTMLDivElement>(null);
  const previewVisibleRef = useRef(true);

  const safeAutoPartsPreviews = autoPartsClipPreviews ?? [];
  const safeAiPreviews = aiClipPreviews ?? [];
  const heroPreviews = clipPreviews.length > 0 ? clipPreviews : safeAutoPartsPreviews;
  const activePreview =
    heroPreviews.find((p) => p.clip.index === activeClipIndex) ?? heroPreviews[0];
  const activeClip = activePreview?.clip;
  const clipStartSec = activeClip?.startSec ?? 0;
  const clipEndSec = activeClip?.endSec ?? 60;
  const clipDuration = activeClip?.durationSec ?? 60;
  const clipSegments: ClipperClipSegmentWindow[] = activeClip?.segments?.length
    ? activeClip.segments
    : [{ startSec: clipStartSec, endSec: clipEndSec }];
  const playbackStart = clipSegments[0]?.startSec ?? clipStartSec;
  const playbackEnd = clipSegments.at(-1)?.endSec ?? clipEndSec;

  /**
   * Preview always renders every platform format, independent of which ones
   * are enabled for render in settings — settings.formats.enabledFormatIds
   * only governs what actually gets exported (see pipeline/stages/render.ts).
   */
  const previewFormats = CLIPPER_FORMAT_DEFS;

  const primaryFormat = useMemo(() => {
    const vertical = previewFormats.find((f) => f.aspectId === "9-16");
    return vertical ?? previewFormats[0];
  }, [previewFormats]);

  const secondaryFormats = useMemo(
    () => previewFormats.filter((f) => f.id !== primaryFormat?.id),
    [previewFormats, primaryFormat?.id],
  );

  const collageRegions = useMemo(
    () => {
      const context = getFrameContext();
      const samples = context?.faceCache?.sortedSamples() ?? [];
      const regions = context?.faceRender?.collageRegions ?? deriveTwoSpeakerRegions(samples);
      const eligibility = context?.faceRender?.collageEligibility
        ?? deriveCollageAspectEligibility(samples, regions, settings.reframe.headroom);
      const enabledAspectIds = CLIPPER_FORMAT_DEFS
        .filter((format) => format.mode === "crop" && settings.formats.enabledFormatIds.includes(format.id))
        .map((format) => format.aspectId);
      return filterRegionsWithEligibleAspects(regions, eligibility, enabledAspectIds);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faceSampleRevision is the actual change signal; getFrameContext is a stable closure over the session.
    [state.faceSampleRevision, settings.reframe.headroom, settings.formats.enabledFormatIds],
  );

  const redrawCanvases = useCallback(() => {
    if (!previewVisibleRef.current) return;
    const drawStart = performance.now();
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0) return;
    const render = getFrameContext();
    if (!render) return;

    const time = video.currentTime;

    if (render.faceCache && !render.faceCache.hasBucket(time) && previewFormats.some((f) => formatNeedsFaceTracking(f, render.settings))) {
      const cache = render.faceCache;
      void cache
        .ensure(time, ToolFaceDetectorService.getInstance(), () => makePreviewFrameSource(video))
        .then(() => {
          const v = videoRef.current;
          if (v && Math.abs(v.currentTime - time) < 0.05) scheduleRedrawRef.current();
        })
        .catch((error) => clipperError("face-cache: preview detection failed", error));
    }

    const source = { width: video.videoWidth, height: video.videoHeight };
    const caches = canvasCachesRef.current;

    for (const formatDef of previewFormats) {
      const canvas = canvasRefs.current[formatDef.id];
      if (!canvas) continue;
      let cache = caches.get(formatDef.id);
      if (!cache) {
        cache = new FrameCanvasCache();
        caches.set(formatDef.id, cache);
      }
      const frameHeight =
        formatDef.id === primaryFormat?.id ? CLIPPER_HERO_PREVIEW_HEIGHT : CLIPPER_CARD_FRAME_HEIGHT;
      drawClipperPreviewFrame(canvas, video, source, formatDef, render, time, frameHeight, cache);
    }

    if (!firstFrameLoggedRef.current) {
      firstFrameLoggedRef.current = true;
      clipperLog("preview: first frame drawn", {
        drawMs: Math.round(performance.now() - drawStart),
        videoWxH: `${video.videoWidth}x${video.videoHeight}`,
        clipIndex: activeClipIndex,
      });
    }
  }, [activeClipIndex, previewFormats, getFrameContext, primaryFormat?.id]);

  const scheduleRedrawRef = useRef<() => void>(() => {});

  const scheduleRedraw = useCallback(() => {
    if (!previewVisibleRef.current) return;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redrawCanvases();
    });
  }, [redrawCanvases]);

  scheduleRedrawRef.current = scheduleRedraw;

  useEffect(() => {
    const el = previewRegionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
        previewVisibleRef.current = visible;

        if (!visible) {
          const video = videoRef.current;
          if (video && !video.paused) video.pause();
          if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          if (vfcIdRef.current != null && video) {
            (video as VideoFrameCallbackCompat).cancelVideoFrameCallback?.(vfcIdRef.current);
            vfcIdRef.current = null;
          }
        } else {
          scheduleRedrawRef.current();
        }
      },
      { threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    firstFrameLoggedRef.current = false;
    clipperLog("preview: mount", {
      trimmedVideoUrl: truncatePreviewUrl(rangeTrimmedVideoUrl),
      previewFormats: previewFormats.map((f) => f.id),
      clipIndex: activeClipIndex,
      clipDuration,
    });

    const watchdog = window.setTimeout(() => {
      const video = videoRef.current;
      if (firstFrameLoggedRef.current || !video) return;
      clipperError("preview: no frame drawn after 5s", new Error("preview stalled"), {
        readyState: video.readyState,
        networkState: video.networkState,
        videoWxH: `${video.videoWidth}x${video.videoHeight}`,
        currentTime: video.currentTime,
        paused: video.paused,
        mediaErrorCode: video.error?.code ?? null,
      });
    }, 5000);

    return () => window.clearTimeout(watchdog);
  }, [activeClipIndex, clipDuration, previewFormats, rangeTrimmedVideoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onVideoError = () => {
      clipperError("preview: video failed", video.error ?? new Error("video load failed"), {
        mediaErrorCode: video.error?.code ?? null,
      });
    };
    video.addEventListener("error", onVideoError);

    const initialLocal = Math.min(3, clipDuration * 0.15);
    const initialTime = localTimeToSourceTime(clipSegments, initialLocal);

    const onReady = () => {
      scheduleRedraw();
      video.currentTime = initialTime;
    };

    const cancelVfc = () => {
      if (vfcIdRef.current != null) {
        (video as VideoFrameCallbackCompat).cancelVideoFrameCallback?.(vfcIdRef.current);
        vfcIdRef.current = null;
      }
    };

    video.addEventListener("loadedmetadata", scheduleRedraw);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("seeked", scheduleRedraw);

    const vfcVideo = video as VideoFrameCallbackCompat;
    const useVfc = typeof vfcVideo.requestVideoFrameCallback === "function";
    let startVfcLoop: (() => void) | undefined;
    let onTimeUpdate: (() => void) | undefined;

    if (useVfc) {
      const scheduleNext = () => {
        scheduleRedraw();
        const v = videoRef.current;
        if (v && !v.paused && !v.ended) {
          const gapTarget = findGapJumpTarget(clipSegments, v.currentTime);
          if (gapTarget != null) {
            v.currentTime = gapTarget;
          } else if (v.currentTime >= playbackEnd - 0.05) {
            v.pause();
            v.currentTime = playbackStart;
          }
        }
        if (v && !v.paused && !v.ended) {
          vfcIdRef.current = vfcVideo.requestVideoFrameCallback!(scheduleNext);
        } else {
          vfcIdRef.current = null;
        }
      };
      startVfcLoop = () => {
        cancelVfc();
        const v = videoRef.current;
        if (v && !v.paused && !v.ended) {
          vfcIdRef.current = vfcVideo.requestVideoFrameCallback!(scheduleNext);
        }
      };
      video.addEventListener("play", startVfcLoop);
      video.addEventListener("pause", cancelVfc);
      video.addEventListener("ended", cancelVfc);
    } else {
      onTimeUpdate = () => {
        if (!video.paused) {
          const gapTarget = findGapJumpTarget(clipSegments, video.currentTime);
          if (gapTarget != null) {
            video.currentTime = gapTarget;
          } else if (video.currentTime >= playbackEnd - 0.05) {
            video.pause();
            video.currentTime = playbackStart;
          }
          scheduleRedraw();
        }
      };
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("pause", scheduleRedraw);
    }

    if (video.readyState >= 2) onReady();
    else scheduleRedraw();

    return () => {
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("loadedmetadata", scheduleRedraw);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("seeked", scheduleRedraw);
      if (useVfc) {
        cancelVfc();
        if (startVfcLoop) video.removeEventListener("play", startVfcLoop);
        video.removeEventListener("pause", cancelVfc);
        video.removeEventListener("ended", cancelVfc);
      } else {
        if (onTimeUpdate) video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("pause", scheduleRedraw);
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [clipDuration, clipSegments, playbackEnd, playbackStart, rangeTrimmedVideoUrl, scheduleRedraw]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const pendingSeek = pendingSeekSourceTimeRef.current;
    pendingSeekSourceTimeRef.current = null;
    const initial =
      pendingSeek ??
      localTimeToSourceTime(clipSegments, Math.min(3, clipDuration * 0.15));
    video.currentTime = initial;
    if (playAfterClipSelectRef.current) {
      playAfterClipSelectRef.current = false;
      void video.play();
    } else {
      video.pause();
    }
    scheduleRedraw();
  }, [activeClipIndex, clipDuration, clipSegments, scheduleRedraw]);

  useEffect(() => {
    scheduleRedraw();
  }, [settings, scheduleRedraw]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime >= clipEndSec - 0.05 || video.currentTime < clipStartSec) {
        video.currentTime = clipStartSec;
      }
      void video.play();
    } else {
      video.pause();
    }
  }, [clipEndSec, clipStartSec]);

  const seekToTranscriptTime = useCallback(
    (clipIndex: number, sourceTimeSec: number) => {
      if (clipIndex !== activeClipIndex) {
        pendingSeekSourceTimeRef.current = sourceTimeSec;
        playAfterClipSelectRef.current = false;
        onSelectClip(clipIndex);
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.currentTime = sourceTimeSec;
      video.pause();
      scheduleRedraw();
    },
    [activeClipIndex, onSelectClip, scheduleRedraw],
  );

  const nudge = useCallback(
    (deltaSec: number) => {
      const video = videoRef.current;
      if (!video) return;
      const local = sourceTimeToLocalTime(clipSegments, video.currentTime);
      const nextLocal = Math.min(clipDuration, Math.max(0, local + deltaSec));
      video.currentTime = localTimeToSourceTime(clipSegments, nextLocal);
    },
    [clipDuration, clipSegments],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "ArrowLeft") {
        nudge(-1);
      } else if (e.code === "ArrowRight") {
        nudge(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nudge]);

  return (
    <VStack align="stretch" gap={3}>
      <Box
        position="fixed"
        width="1px"
        height="1px"
        opacity={0}
        pointerEvents="none"
        left="-9999px"
        aria-hidden
      >
        <video ref={videoRef} src={rangeTrimmedVideoUrl} preload="auto" playsInline />
      </Box>

      <Box
        ref={previewRegionRef}
        w="full"
        position="relative"
        display={{ base: "flex", lg: "block" }}
        flexDirection={{ base: "column" }}
        gap={{ base: 8, lg: 0 }}
      >
        {/* Tytuł jest w lewej kolumnie, żeby prawy panel (absolute top/bottom 0)
            rozciągał się od górnej krawędzi tytułu po dół osi czasu hero. */}
        <Box
          minW={0}
          minH={0}
          w={{ lg: "42%" }}
          display="flex"
          flexDirection="column"
          alignItems={{ lg: "center" }}
          gap={3}
        >
          {sourceFileName ? (
            <Text
              fontSize="2xl"
              fontWeight="bold"
              color={theme.text.primary}
              lineClamp={2}
              w="full"
            >
              {sourceFileName}
            </Text>
          ) : null}
          {primaryFormat ? (
            <ClipperFormatCard
              formatId={primaryFormat.id}
              platform={primaryFormat.platform}
              label={primaryFormat.label}
              frameHeight={CLIPPER_HERO_PREVIEW_HEIGHT}
              footer={
                <ClipperTimeline
                  videoRef={videoRef}
                  segments={clipSegments}
                  clipDuration={clipDuration}
                  activeClipIndex={activeClipIndex}
                />
              }
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[primaryFormat.id] = el;
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                }}
              />
              <ClipperPlayOverlay
                videoRef={videoRef}
                activeClipIndex={activeClipIndex}
                onTogglePlay={togglePlay}
              />
            </ClipperFormatCard>
          ) : null}
        </Box>

        <Box
          minW={0}
          minH={0}
          w={{ base: "full", lg: "auto" }}
          position={{ base: "relative", lg: "absolute" }}
          top={{ lg: 0 }}
          right={{ lg: 0 }}
          bottom={{ lg: 0 }}
          left={{ lg: "calc(42% + var(--chakra-spacing-10))" }}
          h={{ base: "65vh", lg: "auto" }}
          maxH={{ base: "65vh", lg: "none" }}
          display="flex"
          flexDirection="column"
          overflow="hidden"
          border="1px solid"
          borderColor={theme.border.primary}
          borderRadius="28px"
          bg="transparent"
        >
          {/* Insety 8px (px/pt = 2) — spójne z polem czatu na dole panelu (px=2, pb=2). */}
          <HStack
            flexShrink={0}
            px={2}
            pt={2}
            pb={3}
            justify="space-between"
            gap={3}
            flexWrap="wrap"
            align="center"
          >
            <OutlinedActionButton
              startIcon={<ListOrdered size={16} />}
              onClick={onOpenRenderQueue}
              loading={isRendering}
              loadingText="Rendering…"
              flexShrink={0}
              {...TOOLBAR_ACTION_BUTTON_PROPS}
            >
              Go to render queue
            </OutlinedActionButton>

            <HStack gap={1} flexShrink={0} align="center">
              {CLIP_SOURCE_MODE_OPTIONS.map((option) => {
                const isActive = clipSourceMode === option.value;
                return (
                  <Box
                    key={option.value}
                    as="button"
                    type="button"
                    onClick={() => onClipSourceModeChange(option.value)}
                    aria-pressed={isActive}
                    {...TOOLBAR_ACTION_BUTTON_PROPS}
                    {...getOutlinedActionSurfaceProps(theme, isActive)}
                    borderRadius="xl"
                    cursor="pointer"
                    fontWeight="medium"
                    color={isActive ? theme.text.primary : theme.text.muted}
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    px={4}
                  >
                    {option.label}
                  </Box>
                );
              })}
            </HStack>
          </HStack>

          <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
            <ClipperClipsSection
              clipPreviews={clipPreviews}
              autoPartsClipPreviews={safeAutoPartsPreviews}
              aiClipPreviews={safeAiPreviews}
              clipSourceMode={clipSourceMode}
              activeClipIndex={activeClipIndex}
              onSelectClip={onSelectClip}
              onDeleteAiClip={onDeleteAiClip}
              onDeleteAutoPartsClip={onDeleteAutoPartsClip}
              aiChatMessages={aiChatMessages}
              aiChatLoading={aiChatLoading}
              aiChatError={aiChatError}
              aiChatThinking={aiChatThinking}
              aiChatProgressChars={aiChatProgressChars}
              aiChatModel={aiChatModel}
              onAiChatModelChange={onAiChatModelChange}
              onSendAiChatMessage={onSendAiChatMessage}
              onLoadAiChatHistory={onLoadAiChatHistory}
              onNewAiChat={onNewAiChat}
              aiCurrentClipsJsonChars={aiCurrentClipsJsonChars}
              rangeWords={state.rangeWords}
              collageRegions={collageRegions}
              disabledCollageRegionIds={disabledCollageRegionIds}
              onToggleCollageRegion={onToggleCollageRegion}
              onSeekToTranscriptTime={seekToTranscriptTime}
              autoPartsSegmentLengthSec={autoPartsSegmentLengthSec}
              onAutoPartsSegmentLengthChange={onAutoPartsSegmentLengthChange}
              onResetAutoParts={onResetAutoParts}
              autoPartsResegmenting={autoPartsResegmenting}
              onEditClipTranscript={onEditClipTranscript}
              onUndoClipEdit={onUndoClipEdit}
              onRedoClipEdit={onRedoClipEdit}
              canUndoClipEdit={canUndoClipEdit}
              canRedoClipEdit={canRedoClipEdit}
              lastEditedTranscriptRange={lastEditedTranscriptRange}
            />
          </Box>
        </Box>
      </Box>

      <VStack align="stretch" gap={6} pt={4}>
        {secondaryFormats.length > 0 ? (
          <ClipperHorizontalCarousel>
            {secondaryFormats.map((formatDef) => (
              <ClipperFormatCard
                key={formatDef.id}
                formatId={formatDef.id}
                platform={formatDef.platform}
                label={formatDef.label}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[formatDef.id] = el;
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                  }}
                />
              </ClipperFormatCard>
            ))}
          </ClipperHorizontalCarousel>
        ) : null}

        {(exportCount > 0 || isRendering) && onViewExports ? (
          <HStack justify="flex-start" gap={4} flexWrap="wrap" pt={2}>
            <Button
              size="lg"
              variant="outline"
              borderRadius="2xl"
              onClick={onViewExports}
              {...outlineButton}
            >
              Your exports{exportCount > 0 ? ` (${exportCount})` : ""}
            </Button>
          </HStack>
        ) : null}
      </VStack>

      <ClipperSettingsDrawer
        open={settingsOpen}
        onOpenChange={(nextOpen) => (nextOpen ? onSettingsOpen() : onSettingsClose())}
        settings={settings}
        words={activeClip?.words ?? []}
        hasDetectedFaces={state.hasDetectedFaces}
        hasTwoSpeakers={state.hasTwoSpeakers}
        onUpdateSettings={onUpdateSettings}
      />
    </VStack>
  );
};
