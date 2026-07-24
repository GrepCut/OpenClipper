import type {
  ClipperLayoutSample,
  NormalizedBox,
} from "../../../shared/smart-crop.util";
import { splitPanelsPreserveSubjects, splitViewportsAreDistinct } from "./viewport-geometry.util";

const DEFAULT_SPIKE_THRESHOLD = 0.04;
// A lower cutoff removes detector jitter while leaving deliberate reframing
// responsive. The second (reverse) pass below cancels the usual EMA lag.
// At the 5 Hz production-track cadence this is a deliberately strong
// low-pass. The reverse pass avoids introducing the visible follow lag that a
// single EMA would cause.
const DEFAULT_LAMBDA_EMA = 4.0;

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

function panelOwnerKey(sample: ClipperLayoutSample): string {
  return sample.mode === "split"
    ? sample.panelSubjects?.map((subject) => subject.id).join("|") ?? "unknown"
    : "single";
}

function sameLayoutIdentity(a: ClipperLayoutSample, b: ClipperLayoutSample): boolean {
  return a.mode === b.mode
    && a.viewports.length === b.viewports.length
    && panelOwnerKey(a) === panelOwnerKey(b);
}

function validSplit(sample: ClipperLayoutSample, viewports: NormalizedBox[]): boolean {
  return sample.mode !== "split" || (
    splitViewportsAreDistinct(viewports)
    && splitPanelsPreserveSubjects(viewports, sample.panelSubjects)
  );
}

/**
 * 2-Pass Trajectory Smoothing & Spike Filter for Layout Track Samples.
 * Pass 1: Outlier impulse rejection (1-sample & 2-sample spike filtering).
 * Pass 2: zero-phase forward/backward EMA denoise. Unlike a one-way moving
 * average it removes high-frequency camera jitter without making the crop
 * visibly trail the subject.
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
    if (!sameLayoutIdentity(prev, curr) || !sameLayoutIdentity(curr, next)) continue;

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

    if (isSpike && validSplit(curr, interpolatedViewports)) {
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
    if (!sameLayoutIdentity(s0, s1) || !sameLayoutIdentity(s1, s2) || !sameLayoutIdentity(s2, s3)) continue;

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

    if (isSpike2 && validSplit(s1, interpolatedS1) && validSplit(s2, interpolatedS2)) {
      s1.viewports = interpolatedS1;
      s1.reasonCodes = [...(s1.reasonCodes ?? []), "spike-filtered-2"];
      s2.viewports = interpolatedS2;
      s2.reasonCodes = [...(s2.reasonCodes ?? []), "spike-filtered-2"];
    }
  }

  // --- Pass 2: zero-phase temporal denoise within continuous segments ---
  const smoothed: ClipperLayoutSample[] = cleaned.map((s) => ({
    ...s,
    viewports: s.viewports.map((v) => ({ ...v })),
  }));

  let segmentStart = 0;
  while (segmentStart < cleaned.length) {
    let segmentEnd = segmentStart + 1;
    while (
      segmentEnd < cleaned.length
      && !cleaned[segmentEnd]!.cut
      && sameLayoutIdentity(cleaned[segmentEnd]!, cleaned[segmentStart]!)
    ) segmentEnd++;

    // Forward pass: attenuate detector noise while following intended motion.
    for (let index = segmentStart + 1; index < segmentEnd; index++) {
      const current = cleaned[index]!;
      const previous = smoothed[index - 1]!;
      const dt = Math.max(1e-3, current.t - cleaned[index - 1]!.t);
      const alpha = 1 - Math.exp(-lambdaEma * dt);
      const proposed = current.viewports.map((viewport, viewportIndex) =>
        interpolateBox(previous.viewports[viewportIndex]!, viewport, alpha));
      smoothed[index]!.viewports = validSplit(current, proposed) ? proposed : previous.viewports.map((viewport) => ({ ...viewport }));
    }

    // Reverse pass: removes the phase lag introduced by the forward pass.
    for (let index = segmentEnd - 2; index >= segmentStart; index--) {
      const current = smoothed[index]!;
      const following = smoothed[index + 1]!;
      const dt = Math.max(1e-3, cleaned[index + 1]!.t - cleaned[index]!.t);
      const alpha = 1 - Math.exp(-lambdaEma * dt);
      const proposed = current.viewports.map((viewport, viewportIndex) =>
        interpolateBox(following.viewports[viewportIndex]!, viewport, alpha));
      current.viewports = validSplit(cleaned[index]!, proposed) ? proposed : following.viewports.map((viewport) => ({ ...viewport }));
    }
    segmentStart = segmentEnd;
  }

  return smoothed;
}
