import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Button, Checkbox, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { Clapperboard, Minus } from "lucide-react";
import { MainButton } from "../../../shared/components/buttons/main-button.component";
import { CLIPPER_FORMAT_DEFS, getClipperCardFrameSize } from "../shared/formats.util";
import { clipperError } from "../shared/logger.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { yieldToMain } from "../shared/yield-to-main.util";
import type { ClipperClipPreview } from "../shared/state.util";
import type { ClipperFormatSettings } from "../settings/settings.util";
import { formatDurationMmSs } from "../../../shared/utils/time.util";
import { ExportFormatControls } from "./settings/platforms-section.component";

const THUMB_WIDTH = 101;
const THUMB_HEIGHT = 180;
const THUMB_SCALE = 2;
const SMALL_THUMB_HEIGHT = 56;

const SIDE_FORMAT_DEFS = CLIPPER_FORMAT_DEFS.filter((def) => def.aspectId !== "9-16");

function thumbKey(clipIndex: number, formatId: string): string {
  return `${clipIndex}:${formatId}`;
}

interface ClipThumbSpec {
  index: number;
  startSec: number;
  durationSec: number;
}

function yieldIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (
      globalThis as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 200 });
      return;
    }
    void yieldToMain().then(resolve);
  });
}

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

function useClipThumbnails(
  videoUrl: string,
  clips: ClipThumbSpec[],
  canvasRefs: React.RefObject<Record<string, HTMLCanvasElement | null>>,
): (clipIndex: number, el: HTMLElement | null) => void {
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
          if (!needHero && !needSides) continue;

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
  }, [videoUrl, clips, canvasRefs]);

  return registerRow;
}

function formatTime(seconds: number): string {
  return formatDurationMmSs(seconds);
}

function clipTranscript(preview: ClipperClipPreview): string {
  return preview.clip.words.map((word) => word.text).join(" ").trim();
}

type TriState = boolean | "indeterminate";

interface ClipperRenderQueueSetupProps {
  clipPreviews: ClipperClipPreview[];
  rangeTrimmedVideoUrl: string;
  formats: ClipperFormatSettings;
  onChangeFormats: (patch: Partial<ClipperFormatSettings>) => void;
  getClipFormatIds: (clipIndex: number) => string[];
  onToggleClipFormat: (clipIndex: number, formatId: string) => void;
  onSetFormatForAll: (formatId: string, enabled: boolean) => void;
  onSetAllFormatsForClip: (clipIndex: number, enabled: boolean) => void;
  isRendering: boolean;
  onRender: () => void;
  exportCount?: number;
  onViewExports?: () => void;
}

export const ClipperRenderQueueSetup: React.FC<ClipperRenderQueueSetupProps> = ({
  clipPreviews,
  rangeTrimmedVideoUrl,
  formats,
  onChangeFormats,
  getClipFormatIds,
  onToggleClipFormat,
  onSetFormatForAll,
  onSetAllFormatsForClip,
  isRendering,
  onRender,
  exportCount = 0,
  onViewExports,
}) => {
  const { theme, outlineButton } = useClipperUi();

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
  const registerThumbRow = useClipThumbnails(
    rangeTrimmedVideoUrl,
    thumbSpecs,
    thumbCanvasRefs,
  );

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
        <HStack gap={3} flexWrap="wrap">
          {(exportCount > 0 || isRendering) && onViewExports ? (
            <Button
              size="lg"
              variant="outline"
              borderRadius="2xl"
              h="44px"
              onClick={onViewExports}
              {...outlineButton}
            >
              Your exports{exportCount > 0 ? ` (${exportCount})` : ""}
            </Button>
          ) : null}
          <MainButton
            h="44px"
            px={6}
            fontSize="sm"
            fontWeight="semibold"
            borderRadius="full"
            display="inline-flex"
            alignItems="center"
            gap={2}
            bg={`linear-gradient(to right, ${clipperTheme.gradientFrom}, ${clipperTheme.gradientTo})`}
            color={theme.text.onBrand}
            boxShadow={`0 0 16px rgba(${clipperTheme.ctaTintRgb}, 0.28)`}
            _hover={{
              filter: "brightness(1.08)",
              transform: "translateY(-1px)",
              boxShadow: `0 4px 20px rgba(${clipperTheme.ctaTintRgb}, 0.4)`,
              _disabled: { transform: "none", filter: "none", boxShadow: "none" },
            }}
            _disabled={{ opacity: 0.45, cursor: "not-allowed", boxShadow: "none" }}
            onClick={onRender}
            loading={isRendering}
            disabled={totalOutputs === 0}
          >
            {!isRendering ? <Clapperboard size={18} strokeWidth={2} /> : null}
            {isRendering ? "Rendering…" : renderLabel}
          </MainButton>
        </HStack>
      </HStack>

      <VStack
        align="stretch"
        gap={4}
        p={{ base: 4, md: 5 }}
        borderRadius="xl"
        border="1px solid"
        borderColor={theme.border.primary}
        bg={theme.surface.inset}
      >
        <HStack gap={6} flexWrap="wrap" align="flex-start" w="full">
          <VStack align="stretch" gap={1.5} flex="1" minW={{ base: "full", lg: "280px" }}>
            <Text fontSize="xs" color={theme.text.onBrandMuted} lineHeight="1">
              All clips
            </Text>
            <Flex minH="32px" align="center" flexWrap="wrap" gap={3}>
              {CLIPPER_FORMAT_DEFS.map((def) => {
                const checked = globalStateFor(def.id);
                return (
                  <Checkbox.Root
                    key={def.id}
                    size="sm"
                    colorPalette="blue"
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
            </Flex>
          </VStack>

          <ExportFormatControls formats={formats} onChange={onChangeFormats} layout="bar" />
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
              ref={(el) => registerThumbRow(preview.clip.index, el)}
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
                    colorPalette="blue"
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
