import type { ClipperLayoutSample, NormalizedBox } from "../../../shared/smart-crop.util";
import { clamp } from "../../../lib/math.util";
import { samePanelPeople } from "./panel-continuity.util";

const EPSILON = 1e-9;
const STABILIZED_REASON = "split-panels-stabilized";
/** Panel size for a whole split stretch: large enough for most of its samples. */
const PANEL_SIZE_PERCENTILE = 0.8;
/** The person's face keeps at least this share of the panel size from every panel edge. */
const FACE_EDGE_MARGIN = 0.1;
/**
 * Weight of "stay at the per-sample ideal position" against "do not
 * accelerate". Lower is smoother; this keeps easing to roughly half a second
 * (the characteristic length is weight^(-1/4) samples ≈ 3 samples at 5 Hz).
 */
const IDEAL_POSITION_WEIGHT = 0.01;

export function isStabilizedSplit(sample: ClipperLayoutSample): boolean {
  return sample.reasonCodes?.includes(STABILIZED_REASON) === true;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))]!;
}


/**
 * Where a panel centre may be at each sample: the person's whole face stays
 * inside the panel with a margin, and the panel stays inside the frame.
 */
function corridor(target: number, face: [number, number] | null, size: number): [number, number] {
  let low = size / 2;
  let high = 1 - size / 2;
  if (face) {
    const margin = FACE_EDGE_MARGIN * size;
    low = Math.max(low, face[1] + margin - size / 2);
    high = Math.min(high, face[0] - margin + size / 2);
    if (low > high) {
      const middle = clamp((face[0] + face[1]) / 2, size / 2, 1 - size / 2);
      return [middle, middle];
    }
  }
  return low <= high ? [low, high] : [clamp(target, size / 2, 1 - size / 2), clamp(target, size / 2, 1 - size / 2)];
}

/** Active-set rounds before the safety fallback; real corridors settle in a handful. */
const MAX_ACTIVE_SET_ROUNDS = 40;
const FALLBACK_SWEEPS = 50;
const GRADIENT_TOLERANCE = 1e-12;

/**
 * Band of A = weight·I + DᵀD, D the second-difference operator over the path
 * extended by holding its first and last value (the panel is at rest just
 * outside the stretch, which adds a slope term at each end): diagonal, first
 * and second off-diagonal.
 */
function smoothnessBand(count: number): [Float64Array, Float64Array, Float64Array] {
  const diagonal = new Float64Array(count).fill(IDEAL_POSITION_WEIGHT);
  const first = new Float64Array(count);
  const second = new Float64Array(count);
  for (const [a, b] of [[0, 1], [count - 1, count - 2]] as const) {
    diagonal[a]! += 1;
    diagonal[b]! += 1;
    first[Math.min(a, b)]! -= 1;
  }
  for (let row = 0; row + 2 < count; row++) {
    diagonal[row]! += 1;
    diagonal[row + 1]! += 4;
    diagonal[row + 2]! += 1;
    first[row]! -= 2;
    first[row + 1]! -= 2;
    second[row]! += 1;
  }
  return [diagonal, first, second];
}

/**
 * Solves the band system with every pinned sample held at `pinned[i]`: its
 * row and column become the identity, so the free block stays symmetric
 * positive definite and an LDLᵀ factorisation without pivoting is stable.
 */
function solvePinned(
  band: [Float64Array, Float64Array, Float64Array],
  rhs: Float64Array,
  pinned: Float64Array,
  isPinned: Uint8Array,
): Float64Array {
  const [a0, a1, a2] = band;
  const count = rhs.length;
  const d = new Float64Array(count);
  const l1 = new Float64Array(count);
  const l2 = new Float64Array(count);
  const b = new Float64Array(count);
  const off1 = (i: number) => (i + 1 < count && !isPinned[i] && !isPinned[i + 1] ? a1[i]! : 0);
  const off2 = (i: number) => (i + 2 < count && !isPinned[i] && !isPinned[i + 2] ? a2[i]! : 0);
  for (let i = 0; i < count; i++) {
    if (isPinned[i]) {
      b[i] = pinned[i]!;
      continue;
    }
    let value = rhs[i]!;
    // Pinned neighbours move to the right-hand side.
    if (i >= 1 && isPinned[i - 1]) value -= a1[i - 1]! * pinned[i - 1]!;
    if (i + 1 < count && isPinned[i + 1]) value -= a1[i]! * pinned[i + 1]!;
    if (i >= 2 && isPinned[i - 2]) value -= a2[i - 2]! * pinned[i - 2]!;
    if (i + 2 < count && isPinned[i + 2]) value -= a2[i]! * pinned[i + 2]!;
    b[i] = value;
  }
  for (let i = 0; i < count; i++) {
    const diagonal = isPinned[i] ? 1 : a0[i]!;
    const p1 = i >= 1 ? l1[i - 1]! : 0;
    const p2 = i >= 2 ? l2[i - 2]! : 0;
    d[i] = diagonal - p1 * p1 * (i >= 1 ? d[i - 1]! : 0) - p2 * p2 * (i >= 2 ? d[i - 2]! : 0);
    const cross = i >= 1 ? l2[i - 1]! * l1[i - 1]! * d[i - 1]! : 0;
    l1[i] = (off1(i) - cross) / d[i]!;
    l2[i] = off2(i) / d[i]!;
  }
  for (let i = 0; i < count; i++) {
    b[i] = b[i]! - (i >= 1 ? l1[i - 1]! * b[i - 1]! : 0) - (i >= 2 ? l2[i - 2]! * b[i - 2]! : 0);
  }
  for (let i = 0; i < count; i++) b[i] = b[i]! / d[i]!;
  for (let i = count - 1; i >= 0; i--) {
    b[i] = b[i]! - (i + 1 < count ? l1[i]! * b[i + 1]! : 0) - (i + 2 < count ? l2[i]! * b[i + 2]! : 0);
  }
  return b;
}

/**
 * The panel path with the least acceleration that stays close to the
 * per-sample ideal position and never leaves its corridor: minimises
 * weight·Σ(p−ideal)² + Σ(second difference of p)² subject to the corridor.
 * Solved exactly with a primal–dual active set over a banded LDLᵀ solve, so
 * the cost is linear in the stretch length (a projected Gauss–Seidel needed
 * O(n) sweeps and froze the UI for seconds on long podcast splits). The panel
 * eases in and out of every move instead of lurching, starts early when the
 * person is about to travel (the analysis is offline), and the person's face
 * can never leave it.
 */
function smoothestPathInCorridor(corridors: Array<[number, number]>, targets: number[]): number[] {
  const count = targets.length;
  const clampToCorridor = (value: number, index: number) => clamp(value, corridors[index]![0], corridors[index]![1]);
  if (count < 3) return targets.map(clampToCorridor);
  const band = smoothnessBand(count);
  const [a0, a1, a2] = band;
  const rhs = Float64Array.from(targets, (target) => IDEAL_POSITION_WEIGHT * target);
  // 0 free, -1 held at the corridor's low edge, 1 held at its high edge.
  const state = new Int8Array(count);
  const isPinned = new Uint8Array(count);
  const pinned = new Float64Array(count);
  const gradient = (path: Float64Array, i: number) =>
    a0[i]! * path[i]!
    + (i >= 1 ? a1[i - 1]! * path[i - 1]! : 0) + (i + 1 < count ? a1[i]! * path[i + 1]! : 0)
    + (i >= 2 ? a2[i - 2]! * path[i - 2]! : 0) + (i + 2 < count ? a2[i]! * path[i + 2]! : 0)
    - rhs[i]!;

  let path = solvePinned(band, rhs, pinned, isPinned);
  let converged = false;
  for (let round = 0; round < MAX_ACTIVE_SET_ROUNDS && !converged; round++) {
    converged = true;
    for (let i = 0; i < count; i++) {
      const [low, high] = corridors[i]!;
      let next: -1 | 0 | 1;
      if (high - low <= EPSILON) next = -1;
      else if (state[i] === 0) next = path[i]! < low - EPSILON ? -1 : path[i]! > high + EPSILON ? 1 : 0;
      // A held sample is released when the objective would pull it back inside.
      else if (state[i] === -1) next = gradient(path, i) < -GRADIENT_TOLERANCE ? 0 : -1;
      else next = gradient(path, i) > GRADIENT_TOLERANCE ? 0 : 1;
      if (next !== state[i]) converged = false;
      state[i] = next;
      isPinned[i] = next === 0 ? 0 : 1;
      pinned[i] = next === -1 ? low : high;
    }
    if (!converged) path = solvePinned(band, rhs, pinned, isPinned);
  }
  const result = Array.from(path, clampToCorridor);
  if (converged) return result;
  // Safety net for a cycling active set: a bounded number of projected
  // Gauss–Seidel sweeps from the (already nearly optimal) clamped solution.
  for (let sweep = 0; sweep < FALLBACK_SWEEPS; sweep++) {
    for (let i = 0; i < count; i++) {
      const offDiagonal = (i >= 1 ? a1[i - 1]! * result[i - 1]! : 0) + (i + 1 < count ? a1[i]! * result[i + 1]! : 0)
        + (i >= 2 ? a2[i - 2]! * result[i - 2]! : 0) + (i + 2 < count ? a2[i]! * result[i + 2]! : 0);
      result[i] = clampToCorridor((rhs[i]! - offDiagonal) / a0[i]!, i);
    }
  }
  return result;
}

const sameBox = (a: NormalizedBox, b: NormalizedBox) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * A person's box that stays bit-identical for several samples and then jumps
 * is a held, stale measurement (the face was not re-detected; sparser
 * evidence such as the face cache filled in), not a person who stood still
 * and then teleported. Only the first sample of each held value counts as a
 * measurement; the samples in between are interpolated in time, so the panel
 * follows the real, continuous motion instead of the detector's cadence.
 */
function freshFocusTrack(boxes: Array<NormalizedBox | null>, times: number[]): Array<NormalizedBox | null> {
  const anchors: number[] = [];
  boxes.forEach((box, index) => {
    if (!box) return;
    const previous = anchors.length ? boxes[anchors.at(-1)!]! : null;
    if (!previous || !sameBox(previous, box)) anchors.push(index);
  });
  if (anchors.length < 2) return boxes;
  const out = [...boxes];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const from = anchors[k]!;
    const to = anchors[k + 1]!;
    const a = boxes[from]!;
    const b = boxes[to]!;
    for (let index = from + 1; index < to; index++) {
      if (!boxes[index]) continue;
      const f = (times[index]! - times[from]!) / Math.max(EPSILON, times[to]! - times[from]!);
      out[index] = {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        width: a.width + (b.width - a.width) * f,
        height: a.height + (b.height - a.height) * f,
      };
    }
  }
  return out;
}

function stabilizeRun(samples: ClipperLayoutSample[], start: number, end: number): void {
  const run = samples.slice(start, end);
  if (run.length < 2) return;
  const panels = run[0]!.viewports.length;
  const stabilized = run.map(() => [] as NormalizedBox[]);
  const people = run.map(() => [] as Array<NormalizedBox | null>);
  for (let panel = 0; panel < panels; panel++) {
    const boxes = run.map((sample) => sample.viewports[panel]!);
    const ratio = percentile(boxes.map((box) => box.height / Math.max(EPSILON, box.width)), 0.5);
    let width = Math.min(1, percentile(boxes.map((box) => box.width), PANEL_SIZE_PERCENTILE));
    let height = width * ratio;
    if (height > 1) {
      height = 1;
      width = height / Math.max(EPSILON, ratio);
    }
    const focus = freshFocusTrack(run.map((sample) => sample.panelSubjects?.[panel]?.focusBox ?? null), run.map((sample) => sample.t));
    const targetsX = boxes.map((box) => box.x + box.width / 2);
    const targetsY = boxes.map((box) => box.y + box.height / 2);
    const xs = smoothestPathInCorridor(
      targetsX.map((target, index) => corridor(target, focus[index] ? [focus[index]!.x, focus[index]!.x + focus[index]!.width] : null, width)),
      targetsX,
    );
    const ys = smoothestPathInCorridor(
      targetsY.map((target, index) => corridor(target, focus[index] ? [focus[index]!.y, focus[index]!.y + focus[index]!.height] : null, height)),
      targetsY,
    );
    run.forEach((_, index) => {
      stabilized[index]!.push({ x: xs[index]! - width / 2, y: ys[index]! - height / 2, width, height });
      people[index]!.push(focus[index] ?? null);
    });
  }
  run.forEach((sample, index) => {
    samples[start + index] = {
      ...sample,
      viewports: stabilized[index]!,
      // Later stages (runtime interpolation, Studio export) check panels
      // against these boxes, so they must describe the same person track the
      // panel path was planned on, not the raw, possibly stale detection.
      panelSubjects: sample.panelSubjects?.map((subject, panel) => ({
        id: subject.id,
        focusBox: { ...(people[index]![panel] ?? subject.focusBox) },
      })),
      reasonCodes: [...(sample.reasonCodes ?? []), STABILIZED_REASON],
    };
  });
}

/**
 * Split panels are chosen sample by sample; during a camera move that made
 * each panel re-zoom and jump several times a second. For every continuous
 * split stretch (same people in the same panels, no cut) each panel gets one
 * size and the smoothest path that keeps its person well framed. Conversation layouts are already
 * fixed and are left alone.
 */
export function stabilizeSplitRuns(samples: ClipperLayoutSample[]): ClipperLayoutSample[] {
  const out = samples.map((sample) => ({ ...sample, viewports: sample.viewports.map((viewport) => ({ ...viewport })) }));
  const eligible = (sample: ClipperLayoutSample) => sample.mode === "split"
    && !sample.reasonCodes?.includes("conversation-layout");
  let start = 0;
  while (start < out.length) {
    if (!eligible(out[start]!)) {
      start++;
      continue;
    }
    let end = start + 1;
    while (
      end < out.length
      && eligible(out[end]!)
      && out[end]!.viewports.length === out[start]!.viewports.length
      && !out[end]!.cut
      && !out[end]!.speakerCut
      && samePanelPeople(out[end - 1]!, out[end]!)
    ) end++;
    stabilizeRun(out, start, end);
    start = end;
  }
  return out;
}
