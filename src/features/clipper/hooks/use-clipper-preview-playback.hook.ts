import { useCallback, useEffect, useRef } from "react";
import {
  localTimeToSourceTime,
  sourceTimeToLocalTime,
} from "../engine/segmentation";
import { bindPreviewVideoPlayback, redrawPreviewCanvases } from "../components/preview/clipper-preview-video-bindings.util";
import { truncatePreviewUrl, type VideoFrameCallbackCompat } from "../components/preview/clipper-preview-playback.util";
import type { UseClipperPreviewPlaybackParams } from "../components/preview/clipper-preview.types";
import { FrameCanvasCache } from "../lib/media/video-frame-effect.util";
import { clipperError, clipperLog } from "../shared/logger.util";

export type { UseClipperPreviewPlaybackParams } from "../components/preview/clipper-preview.types";

export function useClipperPreviewPlayback({
  rangeTrimmedVideoUrl,
  previewActive = true,
  activeClipIndex,
  clipStartSec,
  clipEndSec,
  clipDuration,
  clipSegments,
  playbackStart,
  playbackEnd,
  previewFormats,
  primaryFormat,
  getFrameContext,
  settings,
  onSelectClip,
}: UseClipperPreviewPlaybackParams) {
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
  const getFrameContextRef = useRef(getFrameContext);
  getFrameContextRef.current = getFrameContext;
  const secondaryCanvasObserverRef = useRef<IntersectionObserver | null>(null);
  const visibleSecondaryFormatIdsRef = useRef<Set<string>>(new Set());
  const lastSecondaryDrawAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pendingDrawRef = useRef({ includeSecondary: false });

  const stopPlaybackCallbacks = useCallback(() => {
    const video = videoRef.current;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (vfcIdRef.current != null && video) {
      (video as VideoFrameCallbackCompat).cancelVideoFrameCallback?.(vfcIdRef.current);
      vfcIdRef.current = null;
    }
  }, []);

  const redrawCanvases = useCallback((visibleSecondaryFormatIds?: ReadonlySet<string>) => {
    if (!previewVisibleRef.current || !previewActive) return;
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0) return;
    redrawPreviewCanvases({
      video,
      canvasRefs: canvasRefs.current,
      canvasCaches: canvasCachesRef.current,
      previewFormats,
      primaryFormatId: primaryFormat?.id,
      getFrameContext: () => getFrameContextRef.current(),
      activeClipIndex,
      firstFrameLoggedRef,
      visibleSecondaryFormatIds,
    });
  }, [activeClipIndex, previewActive, previewFormats, primaryFormat?.id]);

  const scheduleRedrawRef = useRef<(options?: { forceSecondary?: boolean }) => void>(() => {});

  const scheduleRedraw = useCallback((options: { forceSecondary?: boolean } = {}) => {
    if (!previewVisibleRef.current || !previewActive) return;
    const now = performance.now();
    const visibleSecondaryFormatIds = visibleSecondaryFormatIdsRef.current;
    const canDrawSecondary =
      visibleSecondaryFormatIds.size > 0 &&
      (options.forceSecondary || now - lastSecondaryDrawAtRef.current >= 100);
    if (canDrawSecondary) {
      pendingDrawRef.current.includeSecondary = true;
    }
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingDrawRef.current;
      pendingDrawRef.current = { includeSecondary: false };
      const secondaryFormatIds = pending.includeSecondary
        ? new Set(visibleSecondaryFormatIdsRef.current)
        : undefined;
      redrawCanvases(secondaryFormatIds);
      if (pending.includeSecondary) lastSecondaryDrawAtRef.current = performance.now();
    });
  }, [previewActive, redrawCanvases]);

  scheduleRedrawRef.current = scheduleRedraw;

  const registerCanvas = useCallback((formatId: string, canvas: HTMLCanvasElement | null) => {
    const previous = canvasRefs.current[formatId];
    if (previous && previous !== canvas) {
      secondaryCanvasObserverRef.current?.unobserve(previous);
    }
    canvasRefs.current[formatId] = canvas;

    if (!canvas || formatId === primaryFormat?.id) {
      visibleSecondaryFormatIdsRef.current.delete(formatId);
      return;
    }
    secondaryCanvasObserverRef.current?.observe(canvas);
  }, [primaryFormat?.id]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let becameVisible = false;
        for (const entry of entries) {
          const formatId = Object.entries(canvasRefs.current).find(([, canvas]) => canvas === entry.target)?.[0];
          if (!formatId || formatId === primaryFormat?.id) continue;
          if (entry.isIntersecting) {
            visibleSecondaryFormatIdsRef.current.add(formatId);
            becameVisible = true;
          } else {
            visibleSecondaryFormatIdsRef.current.delete(formatId);
          }
        }
        if (becameVisible) scheduleRedrawRef.current({ forceSecondary: true });
      },
      { threshold: 0.01 },
    );
    secondaryCanvasObserverRef.current = observer;
    for (const [formatId, canvas] of Object.entries(canvasRefs.current)) {
      if (canvas && formatId !== primaryFormat?.id) observer.observe(canvas);
    }
    return () => {
      observer.disconnect();
      secondaryCanvasObserverRef.current = null;
      visibleSecondaryFormatIdsRef.current.clear();
    };
  }, [primaryFormat?.id]);

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
          stopPlaybackCallbacks();
        } else {
          scheduleRedrawRef.current({ forceSecondary: true });
        }
      },
      { threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [stopPlaybackCallbacks]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!previewActive) {
      video.pause();
      stopPlaybackCallbacks();
      if (video.getAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
      return;
    }

    if (!rangeTrimmedVideoUrl) return;
    if (video.getAttribute("src") !== rangeTrimmedVideoUrl) {
      video.src = rangeTrimmedVideoUrl;
    }
    previewVisibleRef.current = true;
    scheduleRedrawRef.current({ forceSecondary: true });
  }, [previewActive, rangeTrimmedVideoUrl, stopPlaybackCallbacks]);

  useEffect(() => {
    firstFrameLoggedRef.current = false;
    clipperLog("preview: mount", {
      trimmedVideoUrl: truncatePreviewUrl(rangeTrimmedVideoUrl),
      previewFormats: previewFormats.map((f) => f.id),
      clipIndex: activeClipIndex,
      clipDuration,
      previewActive,
    });

    if (!rangeTrimmedVideoUrl || !previewActive) return;

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
  }, [activeClipIndex, clipDuration, previewActive, previewFormats, rangeTrimmedVideoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !rangeTrimmedVideoUrl || !previewActive) return;

    const onVideoError = () => {
      clipperError("preview: video failed", video.error ?? new Error("video load failed"), {
        mediaErrorCode: video.error?.code ?? null,
      });
    };
    video.addEventListener("error", onVideoError);

    const unbindPlayback = bindPreviewVideoPlayback({
      video,
      videoRef,
      vfcIdRef,
      rafRef,
      clipSegments,
      clipDuration,
      playbackStart,
      playbackEnd,
      scheduleRedraw,
    });

    return () => {
      video.removeEventListener("error", onVideoError);
      unbindPlayback();
    };
  }, [
    clipDuration,
    clipSegments,
    playbackEnd,
    playbackStart,
    previewActive,
    rangeTrimmedVideoUrl,
    scheduleRedraw,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !rangeTrimmedVideoUrl || !previewActive) return;
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
    scheduleRedraw({ forceSecondary: true });
  }, [activeClipIndex, clipDuration, clipSegments, previewActive, rangeTrimmedVideoUrl, scheduleRedraw]);

  useEffect(() => {
    if (!previewActive) return;
    scheduleRedraw({ forceSecondary: true });
  }, [previewActive, settings, scheduleRedraw]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !previewActive) return;
    if (video.paused) {
      if (video.currentTime >= clipEndSec - 0.05 || video.currentTime < clipStartSec) {
        video.currentTime = clipStartSec;
      }
      void video.play();
    } else {
      video.pause();
    }
  }, [clipEndSec, clipStartSec, previewActive]);

  const seekToTranscriptTime = useCallback(
    (clipIndex: number, sourceTimeSec: number) => {
      if (clipIndex !== activeClipIndex) {
        pendingSeekSourceTimeRef.current = sourceTimeSec;
        playAfterClipSelectRef.current = false;
        onSelectClip(clipIndex);
        return;
      }

      const video = videoRef.current;
      if (!video || !previewActive) return;
      video.currentTime = sourceTimeSec;
      video.pause();
      scheduleRedraw({ forceSecondary: true });
    },
    [activeClipIndex, onSelectClip, previewActive, scheduleRedraw],
  );

  const nudge = useCallback(
    (deltaSec: number) => {
      const video = videoRef.current;
      if (!video || !previewActive) return;
      const local = sourceTimeToLocalTime(clipSegments, video.currentTime);
      const nextLocal = Math.min(clipDuration, Math.max(0, local + deltaSec));
      video.currentTime = localTimeToSourceTime(clipSegments, nextLocal);
    },
    [clipDuration, clipSegments, previewActive],
  );

  useEffect(() => {
    if (!previewActive) return;
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
  }, [nudge, previewActive]);

  return {
    videoRef,
    canvasRefs,
    registerCanvas,
    previewRegionRef,
    togglePlay,
    seekToTranscriptTime,
  };
}
