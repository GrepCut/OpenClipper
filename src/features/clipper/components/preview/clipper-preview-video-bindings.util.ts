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

const PREVIEW_PERFORMANCE_SAMPLE_WINDOW = 120;
let previewFrameCount = 0;
let previewTotalDrawMs = 0;
let previewWorstDrawMs = 0;

export interface RedrawPreviewCanvasesParams {
  video: HTMLVideoElement;
  canvasRefs: Record<string, HTMLCanvasElement | null>;
  canvasCaches: Map<string, FrameCanvasCache>;
  previewFormats: ClipperFormatDef[];
  primaryFormatId: string | undefined;
  getFrameContext: () => ClipperFrameContext | null;
  activeClipIndex: number;
  firstFrameLoggedRef: { current: boolean };
  /** Secondary format ids that may redraw in this pass. The primary always redraws. */
  visibleSecondaryFormatIds?: ReadonlySet<string>;
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
  visibleSecondaryFormatIds,
}: RedrawPreviewCanvasesParams): void {
  const drawStart = performance.now();
  const render = getFrameContext();
  if (!render) return;

  const time = video.currentTime;
  const source = { width: video.videoWidth, height: video.videoHeight };
  let drawnFormats = 0;

  for (const formatDef of previewFormats) {
    if (
      formatDef.id !== primaryFormatId &&
      (!visibleSecondaryFormatIds || !visibleSecondaryFormatIds.has(formatDef.id))
    ) {
      continue;
    }
    const canvas = canvasRefs[formatDef.id];
    if (!canvas) continue;
    drawnFormats++;
    let cache = canvasCaches.get(formatDef.id);
    if (!cache) {
      cache = new FrameCanvasCache();
      canvasCaches.set(formatDef.id, cache);
    }
    const frameHeight =
      formatDef.id === primaryFormatId ? CLIPPER_HERO_PREVIEW_HEIGHT : CLIPPER_CARD_FRAME_HEIGHT;
    drawClipperPreviewFrame(canvas, video, source, formatDef, render, time, frameHeight, cache);
  }

  const drawMs = performance.now() - drawStart;
  previewFrameCount++;
  previewTotalDrawMs += drawMs;
  previewWorstDrawMs = Math.max(previewWorstDrawMs, drawMs);
  if (previewFrameCount >= PREVIEW_PERFORMANCE_SAMPLE_WINDOW) {
    clipperLog("preview: render performance", {
      backend: "canvas2d-display-resolution",
      formats: drawnFormats,
      averageDrawMs: Math.round((previewTotalDrawMs / previewFrameCount) * 10) / 10,
      worstDrawMs: Math.round(previewWorstDrawMs * 10) / 10,
      totalVideoFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
      droppedVideoFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
    });
    previewFrameCount = 0;
    previewTotalDrawMs = 0;
    previewWorstDrawMs = 0;
  }

  if (!firstFrameLoggedRef.current) {
    firstFrameLoggedRef.current = true;
    clipperLog("preview: first frame drawn", {
      drawMs: Math.round(drawMs),
      backend: "canvas2d-display-resolution",
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
  scheduleRedraw: (options?: { forceSecondary?: boolean }) => void;
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
}: BindPreviewVideoPlaybackParams): () => void {
  const initialLocal = Math.min(3, clipDuration * 0.15);
  const initialTime = localTimeToSourceTime(clipSegments, initialLocal);

  const onReady = () => {
    video.currentTime = initialTime;
    scheduleRedraw({ forceSecondary: true });
  };
  const onSeeked = () => {
    scheduleRedraw({ forceSecondary: true });
  };
  const onMetadata = () => {
    video.currentTime = initialTime;
    scheduleRedraw({ forceSecondary: true });
  };

  const cancelVfc = () => {
    if (vfcIdRef.current != null) {
      (video as VideoFrameCallbackCompat).cancelVideoFrameCallback?.(vfcIdRef.current);
      vfcIdRef.current = null;
    }
  };

  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("loadeddata", onReady);
  video.addEventListener("seeked", onSeeked);

  const vfcVideo = video as VideoFrameCallbackCompat;
  const useVfc = typeof vfcVideo.requestVideoFrameCallback === "function";
  let startVfcLoop: (() => void) | undefined;
  let onTimeUpdate: (() => void) | undefined;
  const onPauseRedraw = () => scheduleRedraw({ forceSecondary: true });
  const onVfcPause = () => {
    cancelVfc();
    onPauseRedraw();
  };

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
    video.addEventListener("pause", onVfcPause);
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
    video.addEventListener("pause", onPauseRedraw);
  }

  if (video.readyState >= 2) onReady();
  else scheduleRedraw({ forceSecondary: true });

  return () => {
    video.removeEventListener("loadedmetadata", onMetadata);
    video.removeEventListener("loadeddata", onReady);
    video.removeEventListener("seeked", onSeeked);
    if (useVfc) {
      cancelVfc();
      if (startVfcLoop) video.removeEventListener("play", startVfcLoop);
      video.removeEventListener("pause", onVfcPause);
      video.removeEventListener("ended", cancelVfc);
    } else {
      if (onTimeUpdate) video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPauseRedraw);
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
}
