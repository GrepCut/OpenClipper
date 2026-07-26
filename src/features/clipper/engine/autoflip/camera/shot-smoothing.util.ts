import type { AutoFlipCropSample, NormalizedBox } from "../../../shared/smart-crop.util";

const EPSILON = 1e-9;
/** Matches layout trajectory smoothing; strong enough at 5 Hz to kill detector jitter. */
const DEFAULT_LAMBDA_EMA = 3.0;
const MAX_CAMERA_SPEED_PER_SEC = 0.50;
const MAX_CAMERA_ACCELERATION_PER_SEC2 = 1.5;
/** Matches layout spike filter — frame-normalized center hop. */
const SPIKE_THRESHOLD = 0.04;
/** Odd window at 5 Hz ≈ 1 s; near zero-phase impulse reject. */
const MEDIAN_WINDOW = 5;
/** Hold center until move exceeds this fraction of crop size. */
const DEAD_ZONE_FRAC = 0.025;
/** Brake harder into a velocity sign flip than when accelerating. */
const REVERSE_BRAKE_MULT = 2;

function viewportArea(viewport: NormalizedBox): number {
  return Math.max(0, viewport.width) * Math.max(0, viewport.height);
}

function centerOf(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function boxFromCenter(box: NormalizedBox, cx: number, cy: number): NormalizedBox {
  return {
    ...box,
    x: Math.max(0, Math.min(1 - box.width, cx - box.width / 2)),
    y: Math.max(0, Math.min(1 - box.height, cy - box.height / 2)),
  };
}

function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ca = centerOf(a);
  const cb = centerOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

function interpolateBox(a: NormalizedBox, b: NormalizedBox, alpha: number): NormalizedBox {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return {
    x: a.x + (b.x - a.x) * clampedAlpha,
    y: a.y + (b.y - a.y) * clampedAlpha,
    width: a.width + (b.width - a.width) * clampedAlpha,
    height: a.height + (b.height - a.height) * clampedAlpha,
  };
}

function signNonZero(value: number): number {
  if (value > EPSILON) return 1;
  if (value < -EPSILON) return -1;
  return 0;
}

function clampAxisVelocity(
  previous: number,
  desired: number,
  maxSpeed: number,
  maxAccelDelta: number,
): number {
  const reversing = signNonZero(previous) !== 0
    && signNonZero(desired) !== 0
    && signNonZero(previous) !== signNonZero(desired);
  const budget = reversing ? maxAccelDelta * REVERSE_BRAKE_MULT : maxAccelDelta;
  return Math.max(-maxSpeed, Math.min(maxSpeed,
    Math.max(previous - budget, Math.min(previous + budget, desired))));
}

function clampCameraMotion(
  previous: NormalizedBox,
  candidate: NormalizedBox,
  previousVelocity: { x: number; y: number },
  dt: number,
): { crop: NormalizedBox; velocity: { x: number; y: number } } {
  const safeDt = Math.max(1 / 120, dt);
  const previousCenter = centerOf(previous);
  let candidateCenter = centerOf(candidate);

  // Relative dead zone: ignore micro moves that would coast into a later whip.
  const deadX = DEAD_ZONE_FRAC * candidate.width;
  const deadY = DEAD_ZONE_FRAC * candidate.height;
  if (Math.abs(candidateCenter.x - previousCenter.x) < deadX) candidateCenter = { ...candidateCenter, x: previousCenter.x };
  if (Math.abs(candidateCenter.y - previousCenter.y) < deadY) candidateCenter = { ...candidateCenter, y: previousCenter.y };

  const desiredVelocity = {
    x: (candidateCenter.x - previousCenter.x) / safeDt,
    y: (candidateCenter.y - previousCenter.y) / safeDt,
  };
  const maxVelocityDelta = MAX_CAMERA_ACCELERATION_PER_SEC2 * safeDt;
  const velocity = {
    x: clampAxisVelocity(previousVelocity.x, desiredVelocity.x, MAX_CAMERA_SPEED_PER_SEC, maxVelocityDelta),
    y: clampAxisVelocity(previousVelocity.y, desiredVelocity.y, MAX_CAMERA_SPEED_PER_SEC, maxVelocityDelta),
  };
  const x = Math.max(0, Math.min(1 - candidate.width, previousCenter.x + velocity.x * safeDt - candidate.width / 2));
  const y = Math.max(0, Math.min(1 - candidate.height, previousCenter.y + velocity.y * safeDt - candidate.height / 2));
  return { crop: { ...candidate, x, y }, velocity };
}

function hasSceneCutBetween(sceneCuts: number[], previousT: number, currentT: number): boolean {
  return sceneCuts.some((cut) => cut > previousT + EPSILON && cut <= currentT + EPSILON);
}

/** Continuous non-cut index ranges; cut samples and scene cuts break segments. */
function continuousSegments(
  samples: AutoFlipCropSample[],
  sceneCuts: number[],
): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const cutBreak = sample.cut === true
      || (index > 0 && hasSceneCutBetween(sceneCuts, samples[index - 1]!.t, sample.t));
    if (cutBreak) {
      if (start >= 0 && index > start) segments.push({ start, end: index });
      start = sample.cut ? -1 : index;
      continue;
    }
    if (start < 0) start = index;
  }
  if (start >= 0 && start < samples.length) segments.push({ start, end: samples.length });
  return segments;
}

function rejectCenterSpikes(samples: AutoFlipCropSample[], start: number, end: number): void {
  const n = end - start;
  if (n < 3) return;

  // 1-sample spikes
  for (let i = start + 1; i < end - 1; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    const next = samples[i + 1]!;
    const dPrev = centerDistance(curr.crop, prev.crop);
    const dNext = centerDistance(curr.crop, next.crop);
    const dOuter = centerDistance(prev.crop, next.crop);
    if (dPrev > SPIKE_THRESHOLD && dNext > SPIKE_THRESHOLD && dOuter < 0.5 * Math.min(dPrev, dNext)) {
      const dtTotal = Math.max(1e-6, next.t - prev.t);
      const alpha = Math.max(0, Math.min(1, (curr.t - prev.t) / dtTotal));
      const ca = centerOf(prev.crop);
      const cb = centerOf(next.crop);
      curr.crop = boxFromCenter(curr.crop, ca.x + (cb.x - ca.x) * alpha, ca.y + (cb.y - ca.y) * alpha);
    }
  }

  // 2-sample spikes
  for (let i = start + 1; i < end - 2; i++) {
    const s0 = samples[i - 1]!;
    const s1 = samples[i]!;
    const s2 = samples[i + 1]!;
    const s3 = samples[i + 2]!;
    const d01 = centerDistance(s1.crop, s0.crop);
    const d12 = centerDistance(s2.crop, s1.crop);
    const d23 = centerDistance(s3.crop, s2.crop);
    const d03 = centerDistance(s0.crop, s3.crop);
    if (d01 > SPIKE_THRESHOLD && d23 > SPIKE_THRESHOLD && d12 < SPIKE_THRESHOLD && d03 < 0.5 * Math.min(d01, d23)) {
      const dtTotal = Math.max(1e-6, s3.t - s0.t);
      const c0 = centerOf(s0.crop);
      const c3 = centerOf(s3.crop);
      const a1 = Math.max(0, Math.min(1, (s1.t - s0.t) / dtTotal));
      const a2 = Math.max(0, Math.min(1, (s2.t - s0.t) / dtTotal));
      s1.crop = boxFromCenter(s1.crop, c0.x + (c3.x - c0.x) * a1, c0.y + (c3.y - c0.y) * a1);
      s2.crop = boxFromCenter(s2.crop, c0.x + (c3.x - c0.x) * a2, c0.y + (c3.y - c0.y) * a2);
    }
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Odd-window median on crop center only; width/height unchanged. */
function medianFilterCenters(samples: AutoFlipCropSample[], start: number, end: number): void {
  const length = end - start;
  if (length < MEDIAN_WINDOW) return;
  const half = Math.floor(MEDIAN_WINDOW / 2);
  const centers = samples.slice(start, end).map((s) => centerOf(s.crop));
  for (let i = 0; i < length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(length, i + half + 1);
    const window = centers.slice(lo, hi);
    const cx = median(window.map((c) => c.x));
    const cy = median(window.map((c) => c.y));
    const sample = samples[start + i]!;
    sample.crop = boxFromCenter(sample.crop, cx, cy);
  }
}

function denoiseSegment(samples: AutoFlipCropSample[], start: number, end: number): void {
  rejectCenterSpikes(samples, start, end);
  medianFilterCenters(samples, start, end);
}

function zeroPhaseEmaSegment(
  samples: AutoFlipCropSample[],
  start: number,
  end: number,
  lambdaEma: number,
): void {
  const length = end - start;
  if (length <= 2) return;

  for (let index = start + 1; index < end; index++) {
    const current = samples[index]!;
    const previous = samples[index - 1]!;
    const dt = Math.max(1e-3, current.t - previous.t);
    const alpha = 1 - Math.exp(-lambdaEma * dt);
    current.crop = interpolateBox(previous.crop, current.crop, alpha);
  }

  for (let index = end - 2; index >= start; index--) {
    const current = samples[index]!;
    const following = samples[index + 1]!;
    const dt = Math.max(1e-3, following.t - current.t);
    const alpha = 1 - Math.exp(-lambdaEma * dt);
    current.crop = interpolateBox(following.crop, current.crop, alpha);
  }
}

function applyKinematicLimits(
  samples: AutoFlipCropSample[],
  sceneCuts: number[],
): AutoFlipCropSample[] {
  let lastTime = -Infinity;
  let previousCrop: NormalizedBox | null = null;
  let previousVelocity = { x: 0, y: 0 };
  return samples.map((sample, index) => {
    if (hasSceneCutBetween(sceneCuts, lastTime, sample.t) || sample.cut) {
      previousCrop = null;
      previousVelocity = { x: 0, y: 0 };
      lastTime = sample.t;
      if (sample.cut) return sample;
    }
    lastTime = sample.t;
    if (!previousCrop) {
      previousCrop = sample.crop;
      return sample;
    }
    const limited = clampCameraMotion(
      previousCrop,
      sample.crop,
      previousVelocity,
      sample.t - (samples[index - 1]?.t ?? sample.t),
    );
    previousCrop = limited.crop;
    previousVelocity = limited.velocity;
    return { ...sample, crop: limited.crop };
  });
}

export interface ShotCropSmoothingOptions {
  /** EMA cutoff (1/s). Higher = snappier, lower = smoother. Default 3.0. */
  lambdaEma?: number;
}

/**
 * Offline crop-track smoothing: spike/median denoise → zero-phase EMA →
 * relative dead zone + kinematic caps with soft reverse brake.
 */
export function smoothShotCropSamples(
  samples: AutoFlipCropSample[],
  sceneCuts: number[],
  options?: ShotCropSmoothingOptions,
): AutoFlipCropSample[] {
  if (!samples.length) return samples;

  const lambdaEma = options?.lambdaEma ?? DEFAULT_LAMBDA_EMA;
  const working: AutoFlipCropSample[] = samples.map((sample) => ({
    ...sample,
    crop: { ...sample.crop },
  }));

  for (const { start, end } of continuousSegments(working, sceneCuts)) {
    denoiseSegment(working, start, end);
    zeroPhaseEmaSegment(working, start, end, lambdaEma);
  }

  return applyKinematicLimits(working, sceneCuts);
}

export { viewportArea, DEFAULT_LAMBDA_EMA };
