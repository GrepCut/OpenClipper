import { useCallback, useEffect, useRef, useState } from "react";
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
  const [previewTimeSec, setPreviewTimeSec] = useState(0);
  const reportedPreviewTimeRef = useRef(Number.NEGATIVE_INFINITY);

  const reportPreviewTime = useCallback((time: number) => {
    // Decision data changes at analysis cadence, not video-frame cadence.
    if (!Number.isFinite(time) || Math.abs(time - reportedPreviewTimeRef.current) < 0.08) return;
    reportedPreviewTimeRef.current = time;
    setPreviewTimeSec(time);
  }, []);

  const redrawCanvases = useCallback(() => {
    if (!previewVisibleRef.current) return;
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0) return;
    redrawPreviewCanvases({
      video,
      canvasRefs: canvasRefs.current,
      canvasCaches: canvasCachesRef.current,
      previewFormats,
      primaryFormatId: primaryFormat?.id,
      getFrameContext,
      activeClipIndex,
      firstFrameLoggedRef,
    });
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
      onPreviewTimeChange: reportPreviewTime,
    });

    return () => {
      video.removeEventListener("error", onVideoError);
      unbindPlayback();
    };
  }, [clipDuration, clipSegments, playbackEnd, playbackStart, rangeTrimmedVideoUrl, reportPreviewTime, scheduleRedraw]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const pendingSeek = pendingSeekSourceTimeRef.current;
    pendingSeekSourceTimeRef.current = null;
    const initial =
      pendingSeek ??
      localTimeToSourceTime(clipSegments, Math.min(3, clipDuration * 0.15));
    video.currentTime = initial;
    reportPreviewTime(initial);
    if (playAfterClipSelectRef.current) {
      playAfterClipSelectRef.current = false;
      void video.play();
    } else {
      video.pause();
    }
    scheduleRedraw();
  }, [activeClipIndex, clipDuration, clipSegments, reportPreviewTime, scheduleRedraw]);

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

  return {
    videoRef,
    canvasRefs,
    previewRegionRef,
    previewTimeSec,
    togglePlay,
    seekToTranscriptTime,
  };
}
