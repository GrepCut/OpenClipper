import React, { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";
import {
  ensureCaptionFontsReady,
  resolveCaptionPreset,
  type ClipperCaptionPresetId,
} from "../../lib/captions/caption-presets.util";
import { drawPhraseAnimatedCaption } from "../../lib/captions/animated-caption-render.util";
import {
  wordCuesToCaptionGroups,
  type WordCue,
} from "../../lib/media/transcription-export.util";

const PREVIEW_TIMESTAMP = 1.35;
const EXAMPLE_WORD_DURATION = 0.58;
/** Shared geometry keeps preset rows comparable as more caption styles are added. */
const COMPACT_PREVIEW_LAYOUT = {
  anchorY: 0.5,
  fontSizeRatio: 0.46,
  lineHeightRatio: 1,
  maxWidthRatio: 0.94,
} as const;
const PREVIEW_SAMPLE_WORDS = [
  "This",
  "is",
  "a",
  "bold",
  "caption",
  "template.",
] as const;
const COMPACT_PREVIEW_WORDS_PER_GROUP = PREVIEW_SAMPLE_WORDS.length;

const EXAMPLE_WORDS: WordCue[] = PREVIEW_SAMPLE_WORDS.map((text, index) => ({
  text,
  start: index * EXAMPLE_WORD_DURATION,
  end: (index + 1) * EXAMPLE_WORD_DURATION,
}));

interface CaptionPresetPreviewProps {
  presetId: ClipperCaptionPresetId;
  compact?: boolean;
  animate?: boolean;
}

export function CaptionPresetPreview({
  presetId,
  compact = false,
  animate = false,
}: CaptionPresetPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = compact ? 960 : 360;
  const height = compact ? 180 : 640;

  useEffect(() => {
    let cancelled = false;

    let animationFrameId: number | null = null;

    const start = async () => {
      await ensureCaptionFontsReady();
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const preset = resolveCaptionPreset(presetId);
      const previewPreset = compact
        ? {
            ...preset,
            ...COMPACT_PREVIEW_LAYOUT,
            wordsPerGroup: Math.min(
              preset.wordsPerGroup,
              COMPACT_PREVIEW_WORDS_PER_GROUP,
            ),
          }
        : preset;
      const groups = wordCuesToCaptionGroups(
        EXAMPLE_WORDS,
        previewPreset.wordsPerGroup,
      );
      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const shouldAnimate = animate && !reducedMotion;
      const startedAt = performance.now();
      let lastDrawAt = Number.NEGATIVE_INFINITY;

      const drawFrame = (now: number, timestamp: number) => {
        ctx.clearRect(0, 0, width, height);
        drawPhraseAnimatedCaption(
          ctx,
          groups,
          timestamp,
          width,
          height,
          presetId,
          previewPreset,
        );
        lastDrawAt = now;
      };

      if (!shouldAnimate) {
        drawFrame(
          performance.now(),
          preset.renderer === "podcast" ? 3.2 : PREVIEW_TIMESTAMP,
        );
        return;
      }

      const tick = (now: number) => {
        if (cancelled) return;
        if (now - lastDrawAt >= 1000 / 24) {
          drawFrame(now, ((now - startedAt) / 1000) % 3.5);
        }
        animationFrameId = requestAnimationFrame(tick);
      };
      animationFrameId = requestAnimationFrame(tick);
    };

    void start();
    return () => {
      cancelled = true;
      if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
    };
  }, [animate, compact, height, presetId, width]);

  return (
    <Box
      h={
        compact ? { base: "52px", md: "56px" } : { base: "164px", md: "192px" }
      }
      display="flex"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-hidden="true"
        style={{ display: "block", height: "100%", width: "100%" }}
      />
    </Box>
  );
}
