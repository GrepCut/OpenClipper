import type { CentroidSample, FaceCentroid } from "../types/reframe.types";

/** Lower alpha = slower/smoother EMA response to new detections. */
export const SMOOTHING_ALPHA = 0.12;

const FOCUS_DEAD_ZONE = 0.03;
const FOCUS_SWITCH_DISTANCE = 0.12;
const FOCUS_SWITCH_MATCH_DISTANCE = 0.08;
const FOCUS_SWITCH_CONFIRMATION_SAMPLES = 2;
const FOCUS_EXTENT_DEAD_ZONE = 0.015;
const FOCUS_MAX_SPEED_PER_SEC = 0.12;
const FOCUS_MAX_EXTENT_SPEED_PER_SEC = 0.12;

export interface FocusStabilizerState {
  activeTarget: FaceCentroid | null;
  pendingTarget: FaceCentroid | null;
  pendingSamples: number;
  displayed: FaceCentroid | null;
  lastTime: number | null;
}

export function createFocusStabilizer(): FocusStabilizerState {
  return {
    activeTarget: null,
    pendingTarget: null,
    pendingSamples: 0,
    displayed: null,
    lastTime: null,
  };
}

function centroidDistance(a: FaceCentroid, b: FaceCentroid): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function moveTowards(current: number, target: number, maxStep: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

/**
 * Holds a spatially inconsistent face candidate until it repeats, then moves
 * the visible focus point with a dead zone and a time-based speed cap. Face
 * samples currently have no stable id, so proximity is the identity proxy.
 */
export function stabilizeFocusCentroid(
  state: FocusStabilizerState,
  observed: FaceCentroid,
  time: number,
  sceneCut = false,
): FaceCentroid {
  if (sceneCut || !state.activeTarget || !state.displayed) {
    state.activeTarget = observed;
    state.pendingTarget = null;
    state.pendingSamples = 0;
    state.displayed = observed;
    state.lastTime = time;
    return observed;
  }

  if (centroidDistance(observed, state.activeTarget) > FOCUS_SWITCH_DISTANCE) {
    if (state.pendingTarget && centroidDistance(observed, state.pendingTarget) <= FOCUS_SWITCH_MATCH_DISTANCE) {
      state.pendingSamples++;
    } else {
      state.pendingTarget = observed;
      state.pendingSamples = 1;
    }
    if (state.pendingSamples >= FOCUS_SWITCH_CONFIRMATION_SAMPLES) {
      state.activeTarget = observed;
      state.pendingTarget = null;
      state.pendingSamples = 0;
    }
  } else {
    state.activeTarget = observed;
    state.pendingTarget = null;
    state.pendingSamples = 0;
  }

  const target = blendCentroid(state.displayed, state.activeTarget, SMOOTHING_ALPHA);
  const elapsed = Math.max(0, time - (state.lastTime ?? time));
  const distance = centroidDistance(target, state.displayed);
  const maxDistance = FOCUS_MAX_SPEED_PER_SEC * elapsed;
  const moveFactor = distance <= FOCUS_DEAD_ZONE || maxDistance <= 0
    ? 0
    : Math.min(1, maxDistance / distance);
  const extentDelta = target.extent - state.displayed.extent;
  const extent = Math.abs(extentDelta) <= FOCUS_EXTENT_DEAD_ZONE
    ? state.displayed.extent
    : moveTowards(state.displayed.extent, target.extent, FOCUS_MAX_EXTENT_SPEED_PER_SEC * elapsed);
  const stable = {
    x: state.displayed.x + (target.x - state.displayed.x) * moveFactor,
    y: state.displayed.y + (target.y - state.displayed.y) * moveFactor,
    extent,
  };
  state.displayed = stable;
  state.lastTime = time;
  return stable;
}

export function blendCentroid(prev: FaceCentroid, next: FaceCentroid, alpha: number): FaceCentroid {
  return {
    x: alpha * next.x + (1 - alpha) * prev.x,
    y: alpha * next.y + (1 - alpha) * prev.y,
    extent: alpha * next.extent + (1 - alpha) * prev.extent,
  };
}

const FALLBACK_CENTROID: CentroidSample = { t: 0, x: 0.5, y: 0.5, extent: 0 };

function centroidValue(sample: CentroidSample): FaceCentroid {
  return { x: sample.x, y: sample.y, extent: sample.extent };
}

export function interpolateCentroid(
  samples: CentroidSample[],
  t: number,
): { x: number; y: number; extent: number } {
  if (samples.length === 0) return centroidValue(FALLBACK_CENTROID);
  if (t <= samples[0].t) return centroidValue(samples[0]);
  const last = samples[samples.length - 1];
  if (t >= last.t) return centroidValue(last);

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (t >= a.t && t <= b.t) {
      if (b.cut) return t >= b.t ? b : a;
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        extent: a.extent + (b.extent - a.extent) * f,
      };
    }
  }
  return last;
}
