import type { FrameEffectSize } from "../media/video-frame-effect.util";
import type {
  ClipperStudioFramePanel,
  ClipperStudioFrameSample,
} from "./clipper-studio-import.types";

const DEFAULT_EPSILON_PX = 0.5;
const SEGMENT_MATCH_EPSILON_SEC = 0.0005;

export interface SimplifyStudioFrameTrackOptions {
  source: FrameEffectSize;
  output: FrameEffectSize;
  segments?: ReadonlyArray<{ startSec: number; endSec: number }>;
  /** Maximum permitted visual deviation in pixels across box and transform spaces. */
  epsilonPx?: number;
}

interface PanelTransform {
  posX: number;
  posY: number;
  scaleX: number;
  scaleY: number;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function derivePanelTransform(
  panel: ClipperStudioFramePanel,
  source: FrameEffectSize,
  output: FrameEffectSize,
): PanelTransform {
  const srcX = panel.source.x * source.width;
  const srcY = panel.source.y * source.height;
  const srcW = Math.max(1e-6, panel.source.width * source.width);
  const srcH = Math.max(1e-6, panel.source.height * source.height);
  const dstX = panel.destination.x * output.width;
  const dstY = panel.destination.y * output.height;
  const dstW = panel.destination.width * output.width;
  const dstH = panel.destination.height * output.height;
  const scaleX = dstW / srcW;
  const scaleY = dstH / srcH;
  return {
    posX: dstX + (source.width / 2 - srcX) * scaleX,
    posY: dstY + (source.height / 2 - srcY) * scaleY,
    scaleX,
    scaleY,
  };
}

/**
 * Measures the worst-case pixel discrepancy at `mid` when reconstructed by
 * linear interpolation between `a` and `b` at factor `alpha`. Evaluates both
 * raw source/destination boxes and Studio's derived `(position, scale)` space
 * so hyperbolic zoom curves never drift visibly.
 */
export function panelInterpolationErrorPx(
  a: ClipperStudioFramePanel,
  b: ClipperStudioFramePanel,
  mid: ClipperStudioFramePanel,
  alpha: number,
  source: FrameEffectSize,
  output: FrameEffectSize,
): number {
  const srcErr = Math.max(
    Math.abs(lerp(a.source.x, b.source.x, alpha) - mid.source.x) * source.width,
    Math.abs(lerp(a.source.y, b.source.y, alpha) - mid.source.y) * source.height,
    Math.abs(lerp(a.source.width, b.source.width, alpha) - mid.source.width) * source.width,
    Math.abs(lerp(a.source.height, b.source.height, alpha) - mid.source.height) * source.height,
  );
  const dstErr = Math.max(
    Math.abs(lerp(a.destination.x, b.destination.x, alpha) - mid.destination.x) * output.width,
    Math.abs(lerp(a.destination.y, b.destination.y, alpha) - mid.destination.y) * output.height,
    Math.abs(lerp(a.destination.width, b.destination.width, alpha) - mid.destination.width) * output.width,
    Math.abs(lerp(a.destination.height, b.destination.height, alpha) - mid.destination.height) * output.height,
  );
  const tA = derivePanelTransform(a, source, output);
  const tB = derivePanelTransform(b, source, output);
  const tMid = derivePanelTransform(mid, source, output);
  const midSrcW = mid.source.width * source.width;
  const midSrcH = mid.source.height * source.height;
  const transformErr = Math.max(
    Math.abs(lerp(tA.posX, tB.posX, alpha) - tMid.posX),
    Math.abs(lerp(tA.posY, tB.posY, alpha) - tMid.posY),
    Math.abs(lerp(tA.scaleX, tB.scaleX, alpha) - tMid.scaleX) * midSrcW,
    Math.abs(lerp(tA.scaleY, tB.scaleY, alpha) - tMid.scaleY) * midSrcH,
  );
  return Math.max(srcErr, dstErr, transformErr);
}

function sampleInterpolationErrorPx(
  a: ClipperStudioFrameSample,
  b: ClipperStudioFrameSample,
  mid: ClipperStudioFrameSample,
  source: FrameEffectSize,
  output: FrameEffectSize,
): number {
  if (a.panels.length !== b.panels.length || a.panels.length !== mid.panels.length) {
    return Number.POSITIVE_INFINITY;
  }
  const span = b.t - a.t;
  const alpha = span > 1e-9 ? (mid.t - a.t) / span : 0;
  let worst = 0;
  for (let i = 0; i < a.panels.length; i++) {
    const err = panelInterpolationErrorPx(
      a.panels[i]!,
      b.panels[i]!,
      mid.panels[i]!,
      alpha,
      source,
      output,
    );
    if (err > worst) worst = err;
  }
  return worst;
}

function segmentIndexAt(
  t: number,
  segments: ReadonlyArray<{ startSec: number; endSec: number }> | undefined,
): number {
  if (!segments?.length) return 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (
      t >= seg.startSec - SEGMENT_MATCH_EPSILON_SEC &&
      t <= seg.endSec + SEGMENT_MATCH_EPSILON_SEC
    ) {
      return i;
    }
  }
  return -1;
}

function simplifyContinuousSpan(
  samples: ClipperStudioFrameSample[],
  start: number,
  end: number,
  source: FrameEffectSize,
  output: FrameEffectSize,
  epsilonPx: number,
  keep: Uint8Array,
): void {
  keep[start] = 1;
  keep[end] = 1;
  if (end - start <= 1) return;

  const stack: Array<[number, number]> = [[start, end]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo <= 1) continue;
    const first = samples[lo]!;
    const last = samples[hi]!;
    let worstIndex = -1;
    let worstError = epsilonPx;
    for (let k = lo + 1; k < hi; k++) {
      const err = sampleInterpolationErrorPx(first, last, samples[k]!, source, output);
      if (err > worstError) {
        worstError = err;
        worstIndex = k;
      }
    }
    if (worstIndex !== -1) {
      keep[worstIndex] = 1;
      stack.push([lo, worstIndex], [worstIndex, hi]);
    }
  }
}

/**
 * Reduces redundant Studio frame samples while preserving visual parity within
 * `epsilonPx` (default 0.5 px). Hard cuts, panel-count switches, and segment
 * boundaries act as strict barriers so holds before cuts never drift.
 */
export function simplifyStudioFrameTrack(
  samples: ClipperStudioFrameSample[],
  options: SimplifyStudioFrameTrackOptions,
): ClipperStudioFrameSample[] {
  if (samples.length <= 2) return samples;
  const { source, output, segments } = options;
  const epsilonPx = options.epsilonPx ?? DEFAULT_EPSILON_PX;
  const keep = new Uint8Array(samples.length);

  let spanStart = 0;
  let prevSegment = segmentIndexAt(samples[0]!.t, segments);

  for (let i = 1; i < samples.length; i++) {
    const curr = samples[i]!;
    const prev = samples[i - 1]!;
    const currSegment = segmentIndexAt(curr.t, segments);
    const isBarrier =
      Boolean(curr.cut) ||
      curr.panels.length !== prev.panels.length ||
      currSegment !== prevSegment;

    if (isBarrier) {
      simplifyContinuousSpan(samples, spanStart, i - 1, source, output, epsilonPx, keep);
      spanStart = i;
    }
    prevSegment = currSegment;
  }

  simplifyContinuousSpan(
    samples,
    spanStart,
    samples.length - 1,
    source,
    output,
    epsilonPx,
    keep,
  );

  const simplified: ClipperStudioFrameSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (keep[i]) simplified.push(samples[i]!);
  }
  return simplified;
}

const REBASE_EDGE_EPSILON_SEC = 0.001;

/** Shifts a simplified frameTrack onto a cut clip's timeline without dropping boundary keyframes on sub-millisecond drift. */
export function rebaseStudioFrameTrack(
  frameTrack: ClipperStudioFrameSample[],
  offsetSec: number,
  durationSec: number,
): ClipperStudioFrameSample[] {
  return frameTrack
    .filter((sample) => {
      const t = sample.t - offsetSec;
      return t >= -REBASE_EDGE_EPSILON_SEC && t <= durationSec + REBASE_EDGE_EPSILON_SEC;
    })
    .map((sample) => ({
      ...sample,
      t: Math.max(0, Math.min(durationSec, sample.t - offsetSec)),
    }));
}
