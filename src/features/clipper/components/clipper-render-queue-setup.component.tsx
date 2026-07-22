import React, { useEffect, useMemo, useRef } from "react";
import { Box, Button, Checkbox, HStack, Text, VStack } from "@chakra-ui/react";
import { Minus } from "lucide-react";
import { CLIPPER_FORMAT_DEFS, getClipperCardFrameSize } from "../shared/formats.util";
import { clipperError } from "../shared/logger.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperClipPreview } from "../shared/state.util";

const THUMB_WIDTH = 101;
const THUMB_HEIGHT = 180; // 9:16
const THUMB_SCALE = 2;
const SMALL_THUMB_HEIGHT = 56;

/** The 9:16 hero thumb already covers TikTok — the side grid shows the remaining formats. */
const SIDE_FORMAT_DEFS = CLIPPER_FORMAT_DEFS.filter((def) => def.aspectId !== "9-16");

function thumbKey(clipIndex: number, formatId: string): string {
  return `${clipIndex}:${formatId}`;
}

interface ClipThumbSpec {
  index: number;
  startSec: number;
  durationSec: number;
}

/** Center cover-crop ("crop") or letterboxed contain ("pad") paint of the current video frame. */
function paintThumb(canvas: HTMLCanvasElement, video: HTMLVideoElement, mode: "crop" | "pad"): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  if (mode === "pad") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / vw, canvas.height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    return;
  }

  const dstRatio = canvas.width / canvas.height;
  const srcRatio = vw / vh;
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (srcRatio > dstRatio) {
    sw = vh * dstRatio;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / dstRatio;
    sy = (vh - sh) / 2;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

/**
 * Best-effort per-format thumbnails for the queue rows: one hidden video
 * element seeks clip by clip and paints straight into each row's canvases
 * (hero 9:16 under key `${clip}:main`, plus one per side format). No pixel
 * readback (toDataURL) — the trimmed-range URL can come from the Tauri media
 * protocol, which would taint the canvas and make readback throw.
 */
function useClipThumbnails(
  videoUrl: string,
  clips: ClipThumbSpec[],
  canvasRefs: React.RefObject<Record<string, HTMLCanvasElement | null>>,
): void {
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

    void (async () => {
      try {
        await waitReady();
        for (const clip of clips) {
          if (cancelled) return;
          await seekTo(clip.startSec + Math.min(1, clip.durationSec * 0.15));
          if (cancelled || video.videoWidth <= 0) continue;

          const mainCanvas = canvasRefs.current[thumbKey(clip.index, "main")];
          if (mainCanvas) paintThumb(mainCanvas, video, "crop");

          for (const def of SIDE_FORMAT_DEFS) {
            const canvas = canvasRefs.current[thumbKey(clip.index, def.id)];
            if (canvas) paintThumb(canvas, video, def.mode);
          }
        }
      } catch (error) {
        // Thumbnails are decorative — rows render fine without them.
        clipperError("render-queue: thumbnail capture failed", error);
      }
    })();

    return () => {
      cancelled = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl, clips, canvasRefs]);
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clipTranscript(preview: ClipperClipPreview): string {
  return preview.clip.words.map((word) => word.text).join(" ").trim();
}

type TriState = boolean | "indeterminate";

interface ClipperRenderQueueSetupProps {
  clipPreviews: ClipperClipPreview[];
  rangeTrimmedVideoUrl: string;
  getClipFormatIds: (clipIndex: number) => string[];
  onToggleClipFormat: (clipIndex: number, formatId: string) => void;
  onSetFormatForAll: (formatId: string, enabled: boolean) => void;
  onSetAllFormatsForClip: (clipIndex: number, enabled: boolean) => void;
  isRendering: boolean;
  onRender: () => void;
}

export const ClipperRenderQueueSetup: React.FC<ClipperRenderQueueSetupProps> = ({
  clipPreviews,
  rangeTrimmedVideoUrl,
  getClipFormatIds,
  onToggleClipFormat,
  onSetFormatForAll,
  onSetAllFormatsForClip,
  isRendering,
  onRender,
}) => {
  const { theme, panelShadow } = useClipperUi();

  const thumbCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const thumbSpecs = useMemo<ClipThumbSpec[]>(
    () =>
      clipPreviews.map((p) => ({
        index: p.clip.index,
        startSec: p.clip.startSec,
        durationSec: p.clip.durationSec,
      })),
    [clipPreviews],
  );
  useClipThumbnails(rangeTrimmedVideoUrl, thumbSpecs, thumbCanvasRefs);

  const globalStateFor = (formatId: string): TriState => {
    const selectedCount = clipPreviews.filter((p) =>
      getClipFormatIds(p.clip.index).includes(formatId),
    ).length;
    if (selectedCount === 0) return false;
    if (selectedCount === clipPreviews.length) return true;
    return "indeterminate";
  };

  const clipsWithFormats = clipPreviews.filter(
    (p) => getClipFormatIds(p.clip.index).length > 0,
  ).length;
  const totalOutputs = clipPreviews.reduce(
    (sum, p) => sum + getClipFormatIds(p.clip.index).length,
    0,
  );

  const renderLabel =
    totalOutputs === 0
      ? "Render"
      : `Render ${clipsWithFormats} clip${clipsWithFormats > 1 ? "s" : ""} • ${totalOutputs} output${totalOutputs > 1 ? "s" : ""}`;

  return (
    <VStack align="stretch" gap={6}>
      <HStack justify="space-between" flexWrap="wrap" gap={3}>
        <Box>
          <Text fontSize="2xl" fontWeight="bold" color={theme.text.primary} mb={1}>
            Render queue
          </Text>
          <Text fontSize="sm" color={theme.text.muted}>
            Choose which formats to render for each clip.
          </Text>
        </Box>
        <Button
          size="lg"
          borderRadius="2xl"
          bg={clipperTheme.accent}
          color={theme.text.onBrand}
          px={8}
          _hover={{ bg: clipperTheme.accentHover }}
          onClick={onRender}
          loading={isRendering}
          disabled={totalOutputs === 0}
        >
          {isRendering ? "Rendering…" : renderLabel}
        </Button>
      </HStack>

      <VStack
        align="stretch"
        gap={4}
        p={{ base: 4, md: 6 }}
        borderRadius="2xl"
        border="1px solid"
        borderColor={theme.border.primary}
        bg={theme.surface.inset}
        boxShadow={panelShadow}
      >
        <HStack gap={4} flexWrap="wrap" align="center">
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            All clips
          </Text>
          {CLIPPER_FORMAT_DEFS.map((def) => {
            const checked = globalStateFor(def.id);
            return (
              <Checkbox.Root
                key={def.id}
                size="sm"
                colorPalette="purple"
                checked={checked}
                onCheckedChange={() => onSetFormatForAll(def.id, checked !== true)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator indeterminate={<Minus size={12} />} />
                </Checkbox.Control>
                <Checkbox.Label>
                  <Text fontSize="sm" color={theme.text.onBrandMuted}>
                    {def.label}
                  </Text>
                </Checkbox.Label>
              </Checkbox.Root>
            );
          })}
        </HStack>
      </VStack>

      <VStack align="stretch" gap={2}>
        {clipPreviews.map((preview) => {
          const selectedIds = getClipFormatIds(preview.clip.index);
          const transcript = clipTranscript(preview);
          const heroSelected = CLIPPER_FORMAT_DEFS.some(
            (def) => def.aspectId === "9-16" && selectedIds.includes(def.id),
          );

          return (
            <HStack
              key={preview.clip.index}
              gap={4}
              p={3}
              align="center"
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
            >
              <HStack gap={2} flexShrink={0} align="start">
                <Box
                  w={`${THUMB_WIDTH}px`}
                  h={`${THUMB_HEIGHT}px`}
                  borderRadius="lg"
                  overflow="hidden"
                  bg={theme.background.surface}
                  flexShrink={0}
                  display={heroSelected ? undefined : "none"}
                >
                  <canvas
                    ref={(el) => {
                      thumbCanvasRefs.current[thumbKey(preview.clip.index, "main")] = el;
                    }}
                    width={THUMB_WIDTH * THUMB_SCALE}
                    height={THUMB_HEIGHT * THUMB_SCALE}
                    aria-label={`Clip ${preview.clip.index + 1} preview`}
                    style={{ width: "100%", height: "100%", display: "block" }}
                  />
                </Box>

                <Box
                  display="flex"
                  flexWrap="wrap"
                  gap="8px"
                  w="212px"
                  alignContent="flex-start"
                >
                  {SIDE_FORMAT_DEFS.map((def) => {
                    const frame = getClipperCardFrameSize(def.id, SMALL_THUMB_HEIGHT);
                    return (
                      <Box
                        key={def.id}
                        w={`${frame.width}px`}
                        h={`${frame.height}px`}
                        borderRadius="md"
                        overflow="hidden"
                        bg={theme.background.surface}
                        title={def.label}
                        display={selectedIds.includes(def.id) ? undefined : "none"}
                      >
                        <canvas
                          ref={(el) => {
                            thumbCanvasRefs.current[thumbKey(preview.clip.index, def.id)] = el;
                          }}
                          width={frame.width * THUMB_SCALE}
                          height={frame.height * THUMB_SCALE}
                          aria-label={`Clip ${preview.clip.index + 1} ${def.label} preview`}
                          style={{ width: "100%", height: "100%", display: "block" }}
                        />
                      </Box>
                    );
                  })}
                </Box>
              </HStack>

              <VStack align="start" gap={1} flexShrink={0} w="96px">
                <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                  Clip {preview.clip.index + 1}
                </Text>
                <Text fontSize="xs" color={theme.text.muted}>
                  {formatTime(preview.clip.startSec)}–{formatTime(preview.clip.endSec)}
                </Text>
                <Text fontSize="xs" color={theme.text.toggleThumbInactive}>
                  {Math.round(preview.clip.durationSec)}s
                </Text>
                {selectedIds.length === 0 ? (
                  <Text fontSize="xs" color={theme.text.toggleThumbInactive} fontStyle="italic">
                    Skipped
                  </Text>
                ) : null}
              </VStack>

              <Text
                fontSize="sm"
                color={transcript ? theme.text.muted : theme.text.toggleThumbInactive}
                fontStyle={transcript ? undefined : "italic"}
                lineClamp={4}
                flex={1}
                minW={0}
              >
                {transcript || "No transcript for this clip."}
              </Text>

              <VStack
                align="start"
                gap={1.5}
                flexShrink={0}
                pl={4}
                borderLeft="1px solid"
                borderColor={theme.surface.hover}
              >
                <Text
                  as="button"
                  fontSize="xs"
                  fontWeight="medium"
                  color={clipperTheme.accentLight}
                  cursor="pointer"
                  _hover={{ textDecoration: "underline" }}
                  onClick={() =>
                    onSetAllFormatsForClip(preview.clip.index, selectedIds.length === 0)
                  }
                >
                  {selectedIds.length === 0 ? "Select all" : "Deselect all"}
                </Text>
                {CLIPPER_FORMAT_DEFS.map((def) => (
                  <Checkbox.Root
                    key={def.id}
                    size="sm"
                    colorPalette="purple"
                    checked={selectedIds.includes(def.id)}
                    onCheckedChange={() => onToggleClipFormat(preview.clip.index, def.id)}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Checkbox.Label>
                      <Text fontSize="xs" color={theme.text.onBrandMuted}>
                        {def.label}
                      </Text>
                    </Checkbox.Label>
                  </Checkbox.Root>
                ))}
              </VStack>
            </HStack>
          );
        })}
      </VStack>

    </VStack>
  );
};
