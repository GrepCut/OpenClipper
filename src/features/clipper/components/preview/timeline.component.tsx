import React, { useEffect, useRef, useState } from "react";
import { Slider, VStack } from "@chakra-ui/react";
import {
  localTimeToSourceTime,
  sourceTimeToLocalTime,
} from "../../engine/segmentation";
import { clipperTheme } from "../../shared/theme.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import type { ClipperPreviewTimelineProps } from "./clipper-preview.types";

/**
 * Oś czasu klipu z playheadem. Wydzielona i zmemoizowana, bo playhead
 * aktualizuje się co klatkę wideo (rAF podczas odtwarzania) — trzymanie go
 * w stanie rodzica re-renderowało cały subtree preview (selektor klipów,
 * karty formatów, panel ustawień) z częstotliwością klatek.
 */
export const ClipperPreviewTimeline = React.memo(function ClipperPreviewTimeline({
  videoRef,
  segments,
  clipDuration,
  activeClipIndex,
}: ClipperPreviewTimelineProps) {
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
