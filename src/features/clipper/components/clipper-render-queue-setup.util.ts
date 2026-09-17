import { CLIPPER_FORMAT_DEFS } from "../shared/formats.util";
import { yieldToMain } from "../shared/yield-to-main.util";
import type { ExistingExportsByClip } from "../shared/existing-exports.util";
import type { ClipperClipPreview } from "../shared/state.util";

export const THUMB_WIDTH = 101;
export const THUMB_HEIGHT = 180;
export const THUMB_SCALE = 2;
export const SMALL_THUMB_HEIGHT = 56;

export const SIDE_FORMAT_DEFS = CLIPPER_FORMAT_DEFS.filter((def) => def.aspectId !== "9-16");

export interface ClipThumbSpec {
  index: number;
  startSec: number;
  durationSec: number;
}

export type RenderQueueTriState = boolean | "indeterminate";

export interface RenderQueueSelectionStats {
  globalState: Record<string, RenderQueueTriState>;
  /** Format ids already exported for every clip that has them selected. */
  globalExported: Record<string, boolean>;
  /** Clips with at least one output that will actually render. */
  clipsWithFormats: number;
  /** Outputs that will actually render (skipped duplicates excluded). */
  totalOutputs: number;
  /** Selected outputs that already exist on disk from identical render inputs. */
  exportedOutputs: number;
}

export function thumbKey(clipIndex: number, formatId: string): string {
  return `${clipIndex}:${formatId}`;
}

function clipTranscript(preview: ClipperClipPreview): string {
  return preview.clip.words.map((word) => word.text).join(" ").trim();
}

export function clipTranscriptsByIndex(clipPreviews: ClipperClipPreview[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const preview of clipPreviews) {
    map.set(preview.clip.index, clipTranscript(preview));
  }
  return map;
}

export function isRenderQueueHeroSelected(selectedIds: string[]): boolean {
  return CLIPPER_FORMAT_DEFS.some(
    (def) => def.aspectId === "9-16" && selectedIds.includes(def.id),
  );
}

export function computeRenderQueueSelectionStats(
  clipPreviews: ClipperClipPreview[],
  getClipFormatIds: (clipIndex: number) => string[],
  existingExports: ExistingExportsByClip,
  skipExisting: boolean,
): RenderQueueSelectionStats {
  const counts: Record<string, number> = {};
  const exportedCounts: Record<string, number> = {};
  for (const def of CLIPPER_FORMAT_DEFS) {
    counts[def.id] = 0;
    exportedCounts[def.id] = 0;
  }

  let clipsWithFormats = 0;
  let totalOutputs = 0;
  let exportedOutputs = 0;
  const clipCount = clipPreviews.length;

  for (const preview of clipPreviews) {
    const ids = getClipFormatIds(preview.clip.index);
    const exported = existingExports[preview.clip.index] ?? {};
    let pending = 0;
    for (const id of ids) {
      if (id in counts) counts[id]! += 1;
      if (exported[id] !== undefined) {
        exportedOutputs += 1;
        if (id in exportedCounts) exportedCounts[id]! += 1;
        if (skipExisting) continue;
      }
      pending += 1;
    }
    if (pending > 0) clipsWithFormats += 1;
    totalOutputs += pending;
  }

  const globalState: Record<string, RenderQueueTriState> = {};
  const globalExported: Record<string, boolean> = {};
  for (const def of CLIPPER_FORMAT_DEFS) {
    const selectedCount = counts[def.id] ?? 0;
    globalState[def.id] =
      selectedCount === 0 ? false : selectedCount === clipCount ? true : "indeterminate";
    globalExported[def.id] = selectedCount > 0 && exportedCounts[def.id] === selectedCount;
  }

  return { globalState, globalExported, clipsWithFormats, totalOutputs, exportedOutputs };
}

export function yieldIdle(): Promise<void> {
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

export function paintThumb(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  mode: "crop" | "pad",
): void {
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
