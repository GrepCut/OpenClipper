import { useCallback, useEffect, useRef } from "react";
import { redrawPreviewCanvases } from "../components/preview/clipper-preview-video-bindings.util";
import type { VideoFrameCallbackCompat } from "../components/preview/clipper-preview-playback.util";
import type { ClipperFrameContext } from "../engine/types/render.types";
import { FrameCanvasCache } from "../lib/media/video-frame-effect.util";
import type { ClipperFormatDef } from "../shared/formats.util";

/**
 * Draws a single format (reframe + captions) from a video element onto a canvas.
 * Playback itself (seeking, looping) stays with the caller, which owns the video element.
 */
export function useClipperCanvasPreview({
  video,
  active,
  format,
  getFrameContext,
}: {
  video: HTMLVideoElement | null;
  active: boolean;
  format: ClipperFormatDef | undefined;
  getFrameContext: () => ClipperFrameContext | null;
}) {
  const videoRef = useRef(video);
  videoRef.current = video;
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const canvasCachesRef = useRef<Map<string, FrameCanvasCache>>(new Map());
  const firstFrameLoggedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const getFrameContextRef = useRef(getFrameContext);
  getFrameContextRef.current = getFrameContext;

  const scheduleRedraw = useCallback(() => {
    if (!active || !format || rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const current = videoRef.current;
      if (!current || current.videoWidth <= 0) return;
      redrawPreviewCanvases({
        video: current,
        canvasRefs: canvasRefs.current,
        canvasCaches: canvasCachesRef.current,
        previewFormats: [format],
        primaryFormatId: format.id,
        getFrameContext: () => getFrameContextRef.current(),
        activeClipIndex: -1,
        firstFrameLoggedRef,
      });
    });
  }, [active, format]);

  const registerCanvas = useCallback(
    (formatId: string, canvas: HTMLCanvasElement | null) => {
      canvasRefs.current[formatId] = canvas;
      if (canvas) scheduleRedraw();
    },
    [scheduleRedraw],
  );

  useEffect(() => {
    if (!video || !active) return;
    const vfcVideo = video as VideoFrameCallbackCompat;
    const useVfc = typeof vfcVideo.requestVideoFrameCallback === "function";
    let vfcId: number | null = null;

    const cancelVfc = () => {
      if (vfcId != null) {
        vfcVideo.cancelVideoFrameCallback?.(vfcId);
        vfcId = null;
      }
    };
    const onFrame = () => {
      scheduleRedraw();
      vfcId = !video.paused && !video.ended
        ? vfcVideo.requestVideoFrameCallback!(onFrame)
        : null;
    };
    const onPlay = () => {
      cancelVfc();
      if (useVfc) vfcId = vfcVideo.requestVideoFrameCallback!(onFrame);
    };
    const onPause = () => {
      cancelVfc();
      scheduleRedraw();
    };
    const onTimeUpdate = () => scheduleRedraw();

    video.addEventListener("loadeddata", scheduleRedraw);
    video.addEventListener("seeked", scheduleRedraw);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    if (!useVfc) video.addEventListener("timeupdate", onTimeUpdate);
    if (!video.paused) onPlay();
    scheduleRedraw();

    return () => {
      cancelVfc();
      video.removeEventListener("loadeddata", scheduleRedraw);
      video.removeEventListener("seeked", scheduleRedraw);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
      if (!useVfc) video.removeEventListener("timeupdate", onTimeUpdate);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, scheduleRedraw, video]);

  useEffect(() => {
    scheduleRedraw();
  }, [getFrameContext, scheduleRedraw]);

  return { registerCanvas };
}
