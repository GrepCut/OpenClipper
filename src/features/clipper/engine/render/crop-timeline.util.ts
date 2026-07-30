import { evenInt } from "../../lib/media/video-draw.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";
import type { ClipperClipWindow, ClipperFrameContext } from "../types/render.types";
import { resolveClipperFrameGeometry } from "./frame-geometry.util";
import { segmentsTotalDuration } from "../segmentation/clip-time.util";

/** One constant-crop piece on the source timeline (inclusive start, exclusive end). */
export interface NativeCropPiece {
  sourceStart: number;
  sourceEnd: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface NativeAudioWindow {
  sourceStart: number;
  sourceEnd: number;
}

export interface NativeCropTimeline {
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  pieces: NativeCropPiece[];
  /** Source audio windows matching clip segments (fewer than crop pieces). */
  audioWindows: NativeAudioWindow[];
  /** True when every sampled frame was single-panel crop (native path eligible). */
  singleCropOnly: boolean;
}

const SAMPLE_HZ = 5;
const COALESCE_PX = 6;

function roundCrop(sx: number, sy: number, sw: number, sh: number): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  return {
    sx: evenInt(Math.max(0, Math.round(sx))),
    sy: evenInt(Math.max(0, Math.round(sy))),
    sw: evenInt(Math.max(2, Math.round(sw))),
    sh: evenInt(Math.max(2, Math.round(sh))),
  };
}

function cropsClose(
  a: { sx: number; sy: number; sw: number; sh: number },
  b: { sx: number; sy: number; sw: number; sh: number },
  tol = COALESCE_PX,
): boolean {
  return (
    Math.abs(a.sx - b.sx) <= tol &&
    Math.abs(a.sy - b.sy) <= tol &&
    Math.abs(a.sw - b.sw) <= tol &&
    Math.abs(a.sh - b.sh) <= tol
  );
}

/**
 * Samples smart-crop geometry across the clip windows and coalesces into
 * constant-crop pieces suitable for an FFmpeg trim+crop+concat filtergraph.
 */
export function buildNativeCropTimeline(
  formatDef: ClipperFormatDef,
  source: FrameEffectSize,
  output: FrameEffectSize,
  clipWindow: ClipperClipWindow,
  render: ClipperFrameContext,
): NativeCropTimeline {
  const pieces: NativeCropPiece[] = [];
  let singleCropOnly = true;
  const step = 1 / SAMPLE_HZ;

  for (const segment of clipWindow.segments) {
    const start = segment.startSec;
    const end = Math.max(start + 0.001, segment.endSec);
    let cursor = start;
    let open: NativeCropPiece | null = null;

    while (cursor < end - 1e-9) {
      const t = Math.min(cursor, end - 1e-6);
      const geometry = resolveClipperFrameGeometry(formatDef, source, output, t, render);
      if (geometry.mode !== "single-crop" || geometry.panels.length !== 1) {
        singleCropOnly = false;
        open = null;
        cursor += step;
        continue;
      }
      const panel = geometry.panels[0]!;
      const crop = roundCrop(panel.source.sx, panel.source.sy, panel.source.sw, panel.source.sh);
      const pieceEnd = Math.min(end, cursor + step);

      if (open && cropsClose(open, crop)) {
        open.sourceEnd = pieceEnd;
      } else {
        if (open) pieces.push(open);
        open = {
          sourceStart: cursor,
          sourceEnd: pieceEnd,
          ...crop,
        };
      }
      cursor += step;
    }
    if (open) {
      open.sourceEnd = end;
      pieces.push(open);
    }
  }

  // Merge adjacent identical pieces across tiny gaps from sampling noise.
  const merged: NativeCropPiece[] = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      cropsClose(prev, piece) &&
      Math.abs(prev.sourceEnd - piece.sourceStart) < step * 1.5
    ) {
      prev.sourceEnd = piece.sourceEnd;
    } else {
      merged.push({ ...piece });
    }
  }

  return {
    outputWidth: output.width,
    outputHeight: output.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
    pieces: merged,
    audioWindows: clipWindow.segments.map((segment) => ({
      sourceStart: segment.startSec,
      sourceEnd: Math.max(segment.startSec + 0.001, segment.endSec),
    })),
    singleCropOnly: singleCropOnly && merged.length > 0,
  };
}

/** True when the clip window is eligible for the native single-crop FFmpeg path. */
export function isNativeSingleCropEligible(
  formatDef: ClipperFormatDef,
  source: FrameEffectSize,
  output: FrameEffectSize,
  clipWindow: ClipperClipWindow,
  render: ClipperFrameContext,
): boolean {
  if (!clipWindow.segments.length) return false;
  const duration = segmentsTotalDuration(clipWindow.segments);
  if (duration <= 0) return false;
  // Spot-check a few timestamps across the window (cheap gate before full build).
  const checks = Math.min(12, Math.max(3, Math.ceil(duration)));
  for (let i = 0; i < checks; i++) {
    let remaining = (duration * i) / Math.max(1, checks - 1);
    let sourceT = clipWindow.segments[0]!.startSec;
    for (const segment of clipWindow.segments) {
      const segDur = Math.max(0, segment.endSec - segment.startSec);
      if (remaining <= segDur) {
        sourceT = segment.startSec + remaining;
        break;
      }
      remaining -= segDur;
      sourceT = segment.endSec;
    }
    const geometry = resolveClipperFrameGeometry(formatDef, source, output, sourceT, render);
    if (geometry.mode !== "single-crop" || geometry.panels.length !== 1) return false;
  }
  return true;
}
