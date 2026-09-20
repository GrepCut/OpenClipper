import { useCallback, useEffect, useRef } from "react";
import { clipperError } from "../shared/logger.util";
import { yieldToMain } from "../shared/yield-to-main.util";
import {
  SIDE_FORMAT_DEFS,
  paintThumb,
  thumbKey,
  yieldIdle,
  type ClipThumbSpec,
} from "../components/clipper-render-queue-setup.util";

export interface UseClipThumbnailsResult {
  registerRow: (clipIndex: number, el: HTMLElement | null) => void;
  setCanvasRef: (clipIndex: number, formatId: string, el: HTMLCanvasElement | null) => void;
}

export function useClipThumbnails(
  videoUrl: string,
  clips: ClipThumbSpec[],
): UseClipThumbnailsResult {
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const rowElementsRef = useRef(new Map<number, HTMLElement>());
  const visibleRef = useRef(new Set<number>());
  const heroDoneRef = useRef(new Set<number>());
  const sidesDoneRef = useRef(new Set<number>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);

  const registerRow = useCallback((clipIndex: number, el: HTMLElement | null) => {
    const map = rowElementsRef.current;
    const prev = map.get(clipIndex);
    if (prev && prev !== el) {
      observerRef.current?.unobserve(prev);
      map.delete(clipIndex);
    }
    if (!el) {
      visibleRef.current.delete(clipIndex);
      return;
    }
    el.dataset.clipIndex = String(clipIndex);
    map.set(clipIndex, el);
    observerRef.current?.observe(el);
  }, []);

  const setCanvasRef = useCallback(
    (clipIndex: number, formatId: string, el: HTMLCanvasElement | null) => {
      canvasRefs.current[thumbKey(clipIndex, formatId)] = el;
    },
    [],
  );

  useEffect(() => {
    heroDoneRef.current.clear();
    sidesDoneRef.current.clear();
  }, [videoUrl, clips]);

  useEffect(() => {
    let cancelled = false;

    const video = document.createElement("video");
    video.src = videoUrl;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const waitReady = () =>
      new Promise<void>((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        const cleanup = () => {
          video.removeEventListener("loadeddata", onLoaded);
          video.removeEventListener("error", onError);
        };
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(video.error ?? new Error("thumbnail video failed to load"));
        };
        video.addEventListener("loadeddata", onLoaded);
        video.addEventListener("error", onError);
      });

    const seekTo = (time: number) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };
        const onSeeked = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(video.error ?? new Error("thumbnail seek failed"));
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.currentTime = time;
      });

    const wake = () => {
      const resolve = wakeRef.current;
      wakeRef.current = null;
      resolve?.();
    };

    const waitForWake = () =>
      new Promise<void>((resolve) => {
        wakeRef.current = resolve;
      });

    const observer = new IntersectionObserver(
      (entries) => {
        let becameVisible = false;
        for (const entry of entries) {
          const raw = (entry.target as HTMLElement).dataset.clipIndex;
          const idx = raw == null ? NaN : Number(raw);
          if (!Number.isFinite(idx)) continue;
          if (entry.isIntersecting) {
            if (!visibleRef.current.has(idx)) {
              visibleRef.current.add(idx);
              becameVisible = true;
            }
          } else {
            visibleRef.current.delete(idx);
          }
        }
        if (becameVisible) wake();
      },
      { rootMargin: "120px 0px", threshold: 0.01 },
    );
    observerRef.current = observer;
    for (const el of rowElementsRef.current.values()) {
      observer.observe(el);
    }

    void (async () => {
      try {
        await waitReady();
        while (!cancelled) {
          const next = clips.find(
            (clip) =>
              visibleRef.current.has(clip.index) &&
              (!heroDoneRef.current.has(clip.index) || !sidesDoneRef.current.has(clip.index)),
          );
          if (!next) {
            await waitForWake();
            if (cancelled) return;
            continue;
          }

          const needHero = !heroDoneRef.current.has(next.index);
          const needSides = !sidesDoneRef.current.has(next.index);

          await seekTo(next.startSec + Math.min(1, next.durationSec * 0.15));
          await yieldToMain();
          if (cancelled || video.videoWidth <= 0) {
            if (video.videoWidth <= 0) {
              heroDoneRef.current.add(next.index);
              sidesDoneRef.current.add(next.index);
            }
            continue;
          }

          if (needHero) {
            const mainCanvas = canvasRefs.current[thumbKey(next.index, "main")];
            if (mainCanvas) paintThumb(mainCanvas, video, "crop");
            heroDoneRef.current.add(next.index);
            await yieldToMain();
            if (cancelled) return;
          }

          if (needSides && visibleRef.current.has(next.index)) {
            await yieldIdle();
            if (cancelled) return;
            for (const def of SIDE_FORMAT_DEFS) {
              const canvas = canvasRefs.current[thumbKey(next.index, def.id)];
              if (canvas) paintThumb(canvas, video, def.mode);
            }
            sidesDoneRef.current.add(next.index);
            await yieldToMain();
          }
        }
      } catch (error) {
        clipperError("render-queue: thumbnail capture failed", error);
      }
    })();

    return () => {
      cancelled = true;
      wake();
      observer.disconnect();
      observerRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl, clips]);

  return { registerRow, setCanvasRef };
}
