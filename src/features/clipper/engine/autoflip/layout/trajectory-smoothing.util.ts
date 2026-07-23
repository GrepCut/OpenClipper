import type {
  ClipperLayoutSample,
  NormalizedBox,
} from "../../../shared/smart-crop.util";

const DEFAULT_SPIKE_THRESHOLD = 0.04;
const DEFAULT_LAMBDA_EMA = 8.0;

function boxDistance(a: NormalizedBox, b: NormalizedBox): number {
  const cxA = a.x + a.width / 2;
  const cyA = a.y + a.height / 2;
  const cxB = b.x + b.width / 2;
  const cyB = b.y + b.height / 2;
  return Math.hypot(cxA - cxB, cyA - cyB);
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

export interface TrajectorySmoothingOptions {
  spikeThreshold?: number;
  lambdaEma?: number;
}

/**
 * 2-Pass Trajectory Smoothing & Spike Filter for Layout Track Samples.
 * Pass 1: Outlier impulse rejection (1-sample & 2-sample spike filtering).
 * Pass 2: Low-pass EMA (Exponential Moving Average) temporal smoothing.
 */
export function smoothLayoutTrackSamples(
  samples: ClipperLayoutSample[],
  options?: TrajectorySmoothingOptions,
): ClipperLayoutSample[] {
  if (!samples || samples.length <= 2) return samples;

  const spikeThreshold = options?.spikeThreshold ?? DEFAULT_SPIKE_THRESHOLD;
  const lambdaEma = options?.lambdaEma ?? DEFAULT_LAMBDA_EMA;

  const cleaned: ClipperLayoutSample[] = samples.map((s) => ({
    ...s,
    viewports: s.viewports.map((v) => ({ ...v })),
    candidateViewports: s.candidateViewports?.map((v) => ({ ...v })),
    baselineViewports: s.baselineViewports?.map((v) => ({ ...v })),
  }));
  const n = cleaned.length;

  // --- Pass 1: Outlier Spike Rejection ---
  // 1-sample spikes
  for (let i = 1; i < n - 1; i++) {
    const prev = cleaned[i - 1]!;
    const curr = cleaned[i]!;
    const next = cleaned[i + 1]!;

    if (curr.cut || next.cut) continue;
    if (prev.viewports.length !== curr.viewports.length || curr.viewports.length !== next.viewports.length) continue;
    if (prev.mode !== curr.mode || curr.mode !== next.mode) continue;

    const interpolatedViewports: NormalizedBox[] = [];
    let isSpike = false;

    for (let vIdx = 0; vIdx < curr.viewports.length; vIdx++) {
      const vPrev = prev.viewports[vIdx]!;
      const vCurr = curr.viewports[vIdx]!;
      const vNext = next.viewports[vIdx]!;

      const dPrev = boxDistance(vCurr, vPrev);
      const dNext = boxDistance(vCurr, vNext);
      const dOuter = boxDistance(vPrev, vNext);

      if (dPrev > spikeThreshold && dNext > spikeThreshold && dOuter < 0.5 * Math.min(dPrev, dNext)) {
        isSpike = true;
        const dtTotal = Math.max(1e-6, next.t - prev.t);
        const alpha = Math.max(0, Math.min(1, (curr.t - prev.t) / dtTotal));
        interpolatedViewports.push(interpolateBox(vPrev, vNext, alpha));
      } else {
        interpolatedViewports.push(vCurr);
      }
    }

    if (isSpike) {
      curr.viewports = interpolatedViewports;
      curr.reasonCodes = [...(curr.reasonCodes ?? []), "spike-filtered-1"];
    }
  }

  // 2-sample spikes
  for (let i = 1; i < n - 2; i++) {
    const s0 = cleaned[i - 1]!;
    const s1 = cleaned[i]!;
    const s2 = cleaned[i + 1]!;
    const s3 = cleaned[i + 2]!;

    if (s1.cut || s2.cut || s3.cut) continue;
    if (
      s0.viewports.length !== s1.viewports.length ||
      s1.viewports.length !== s2.viewports.length ||
      s2.viewports.length !== s3.viewports.length
    ) continue;
    if (s0.mode !== s1.mode || s1.mode !== s2.mode || s2.mode !== s3.mode) continue;

    let isSpike2 = false;
    const interpolatedS1: NormalizedBox[] = [];
    const interpolatedS2: NormalizedBox[] = [];

    for (let vIdx = 0; vIdx < s1.viewports.length; vIdx++) {
      const v0 = s0.viewports[vIdx]!;
      const v1 = s1.viewports[vIdx]!;
      const v2 = s2.viewports[vIdx]!;
      const v3 = s3.viewports[vIdx]!;

      const d01 = boxDistance(v1, v0);
      const d12 = boxDistance(v2, v1);
      const d23 = boxDistance(v3, v2);
      const d03 = boxDistance(v0, v3);

      if (d01 > spikeThreshold && d23 > spikeThreshold && d12 < spikeThreshold && d03 < 0.5 * Math.min(d01, d23)) {
        isSpike2 = true;
        const dtTotal = Math.max(1e-6, s3.t - s0.t);
        const alpha1 = Math.max(0, Math.min(1, (s1.t - s0.t) / dtTotal));
        const alpha2 = Math.max(0, Math.min(1, (s2.t - s0.t) / dtTotal));
        interpolatedS1.push(interpolateBox(v0, v3, alpha1));
        interpolatedS2.push(interpolateBox(v0, v3, alpha2));
      } else {
        interpolatedS1.push(v1);
        interpolatedS2.push(v2);
      }
    }

    if (isSpike2) {
      s1.viewports = interpolatedS1;
      s1.reasonCodes = [...(s1.reasonCodes ?? []), "spike-filtered-2"];
      s2.viewports = interpolatedS2;
      s2.reasonCodes = [...(s2.reasonCodes ?? []), "spike-filtered-2"];
    }
  }

  // --- Pass 2: Low-pass EMA temporal smoothing within continuous segments ---
  const smoothed: ClipperLayoutSample[] = cleaned.map((s) => ({
    ...s,
    viewports: s.viewports.map((v) => ({ ...v })),
  }));

  let prevViewports: NormalizedBox[] | null = null;

  for (let i = 0; i < cleaned.length; i++) {
    const sample = cleaned[i]!;

    if (sample.cut || prevViewports === null || sample.viewports.length !== prevViewports.length) {
      prevViewports = sample.viewports.map((v) => ({ ...v }));
      smoothed[i]!.viewports = prevViewports;
      continue;
    }

    const dt = Math.max(1e-3, sample.t - cleaned[i - 1]!.t);
    const alpha = 1.0 - Math.exp(-lambdaEma * dt);

    const newViewports: NormalizedBox[] = [];
    for (let vIdx = 0; vIdx < sample.viewports.length; vIdx++) {
      const vCurr = sample.viewports[vIdx]!;
      const vPrev = prevViewports[vIdx]!;
      newViewports.push(interpolateBox(vPrev, vCurr, alpha));
    }

    smoothed[i]!.viewports = newViewports;
    prevViewports = newViewports;
  }

  return smoothed;
}
