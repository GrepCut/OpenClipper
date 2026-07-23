import type { MutableRefObject, RefObject } from "react";
import { drawClipperPreviewFrame, type ClipperFrameContext } from "../../engine/render/index";
import {
  findGapJumpTarget,
  localTimeToSourceTime,
  type ClipperClipSegmentWindow,
} from "../../engine/segmentation";
import { FrameCanvasCache } from "../../lib/media/video-frame-effect.util";
import { clipperLog } from "../../shared/logger.util";
import { CLIPPER_CARD_FRAME_HEIGHT, CLIPPER_HERO_PREVIEW_HEIGHT } from "../../shared/formats.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import type { VideoFrameCallbackCompat } from "./clipper-preview-playback.util";

export interface RedrawPreviewCanvasesParams {
  video: HTMLVideoElement;
  canvasRefs: Record<string, HTMLCanvasElement | null>;
  canvasCaches: Map<string, FrameCanvasCache>;
  previewFormats: ClipperFormatDef[];
  primaryFormatId: string | undefined;
  getFrameContext: () => ClipperFrameContext | null;
  activeClipIndex: number;
  firstFrameLoggedRef: { current: boolean };
}

export function redrawPreviewCanvases({
  video,
  canvasRefs,
  canvasCaches,
  previewFormats,
  primaryFormatId,
  getFrameContext,
  activeClipIndex,
  firstFrameLoggedRef,
}: RedrawPreviewCanvasesParams): void {
  const drawStart = performance.now();
  const render = getFrameContext();
  if (!render) return;

  const time = video.currentTime;
  const source = { width: video.videoWidth, height: video.videoHeight };

  for (const formatDef of previewFormats) {
    const canvas = canvasRefs[formatDef.id];
    if (!canvas) continue;
    let cache = canvasCaches.get(formatDef.id);
    if (!cache) {
      cache = new FrameCanvasCache();
      canvasCaches.set(formatDef.id, cache);
    }
    const frameHeight =
      formatDef.id === primaryFormatId ? CLIPPER_HERO_PREVIEW_HEIGHT : CLIPPER_CARD_FRAME_HEIGHT;
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
}

export interface BindPreviewVideoPlaybackParams {
  video: HTMLVideoElement;
  videoRef: RefObject<HTMLVideoElement | null>;
  vfcIdRef: MutableRefObject<number | null>;
  rafRef: MutableRefObject<number | null>;
  clipSegments: ClipperClipSegmentWindow[];
  clipDuration: number;
  playbackStart: number;
  playbackEnd: number;
  scheduleRedraw: () => void;
  onPreviewTimeChange?: (time: number) => void;
}

export function bindPreviewVideoPlayback({
  video,
  videoRef,
  vfcIdRef,
  rafRef,
  clipSegments,
  clipDuration,
  playbackStart,
  playbackEnd,
  scheduleRedraw,
  onPreviewTimeChange,
}: BindPreviewVideoPlaybackParams): () => void {
  const initialLocal = Math.min(3, clipDuration * 0.15);
  const initialTime = localTimeToSourceTime(clipSegments, initialLocal);

  const onReady = () => {
    scheduleRedraw();
    video.currentTime = initialTime;
    onPreviewTimeChange?.(initialTime);
  };
  const onSeeked = () => {
    onPreviewTimeChange?.(video.currentTime);
    scheduleRedraw();
  };

  const cancelVfc = () => {
    if (vfcIdRef.current != null) {
      (video as VideoFrameCallbackCompat).cancelVideoFrameCallback?.(vfcIdRef.current);
      vfcIdRef.current = null;
    }
  };

  video.addEventListener("loadedmetadata", scheduleRedraw);
  video.addEventListener("loadeddata", onReady);
  video.addEventListener("seeked", onSeeked);

  const vfcVideo = video as VideoFrameCallbackCompat;
  const useVfc = typeof vfcVideo.requestVideoFrameCallback === "function";
  let startVfcLoop: (() => void) | undefined;
  let onTimeUpdate: (() => void) | undefined;

  if (useVfc) {
    const scheduleNext = () => {
      onPreviewTimeChange?.(video.currentTime);
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
      onPreviewTimeChange?.(video.currentTime);
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
    video.removeEventListener("loadedmetadata", scheduleRedraw);
    video.removeEventListener("loadeddata", onReady);
    video.removeEventListener("seeked", onSeeked);
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
}
