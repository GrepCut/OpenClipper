import { evaluateGroundTruth } from "./ground-truth";
import type { BenchmarkMetrics, TestKeyframe, TestTarget } from "../types";
import type { ClipperLayoutMode } from "../../clipper/shared/smart-crop";

export interface NormalizedViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BenchmarkFrameInput {
  timestampUs: number;
  viewports: NormalizedViewport[];
  layoutMode?: ClipperLayoutMode;
}

export interface BenchmarkTargetDetail {
  slot: 0 | 1;
  visible: boolean;
  focusHit: boolean;
  focusErrorRadius: number;
}

export interface BenchmarkFrameDetail {
  timestampUs: number;
  targetCount: number;
  allTargetsVisible: boolean;
  viewports: NormalizedViewport[];
  layoutMode: ClipperLayoutMode;
  targets: BenchmarkTargetDetail[];
}

function contains(viewport: NormalizedViewport, target: TestTarget): boolean {
  return target.x >= viewport.x - 1e-9
    && target.x <= viewport.x + viewport.width + 1e-9
    && target.y >= viewport.y - 1e-9
    && target.y <= viewport.y + viewport.height + 1e-9;
}

function distanceInShortSideUnits(
  target: TestTarget,
  viewport: NormalizedViewport,
  sourceWidth: number,
  sourceHeight: number,
): number {
  const dx = (target.x - (viewport.x + viewport.width / 2)) * sourceWidth;
  const dy = (target.y - (viewport.y + viewport.height / 2)) * sourceHeight;
  return Math.hypot(dx, dy) / Math.max(1, Math.min(sourceWidth, sourceHeight));
}

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const factor = index - lower;
  return sorted[lower]! * (1 - factor) + sorted[upper]! * factor;
}

export function calculateBenchmarkMetrics(input: {
  keyframes: TestKeyframe[];
  frames: BenchmarkFrameInput[];
  sourceWidth: number;
  sourceHeight: number;
}): { metrics: BenchmarkMetrics; details: BenchmarkFrameDetail[] } {
  let targetObservationCount = 0;
  let visibleTargetCount = 0;
  let allTargetsVisibleFrameCount = 0;
  let focusHitCount = 0;
  let dualTargetFrameCount = 0;
  let dualTargetAllVisibleFrameCount = 0;
  let singleTargetFrameCount = 0;
  let singleTargetVisibleCount = 0;
  let singleTargetFocusHitCount = 0;
  let dualTargetObservationCount = 0;
  let dualTargetFocusHitCount = 0;
  const errors: number[] = [];
  const details: BenchmarkFrameDetail[] = [];
  const layoutModeFrameCounts: Record<ClipperLayoutMode, number> = {
    "single-crop": 0,
    split: 0,
    contain: 0,
  };
  const centerVelocities: number[] = [];
  const centerAccelerations: number[] = [];
  const reacquisitionDurationsMs: number[] = [];
  const missStartedAt = new Map<0 | 1, number>();
  const previouslyHit = new Map<0 | 1, boolean>();
  let previousCenter: { x: number; y: number; timestampUs: number } | null = null;
  let previousVelocity: { x: number; y: number; timestampUs: number } | null = null;

  for (const frame of input.frames) {
    const layoutMode = frame.layoutMode ?? (frame.viewports.length > 1 ? "split" : "single-crop");
    layoutModeFrameCounts[layoutMode] += 1;
    const targets = evaluateGroundTruth(input.keyframes, frame.timestampUs);
    const targetDetails = targets.map<BenchmarkTargetDetail>((target) => {
      const visible = frame.viewports.some((viewport) => contains(viewport, target));
      const distance = frame.viewports.length
        ? Math.min(...frame.viewports.map((viewport) =>
          distanceInShortSideUnits(target, viewport, input.sourceWidth, input.sourceHeight)))
        : Number.POSITIVE_INFINITY;
      const focusErrorRadius = distance / Math.max(0.001, target.radius);
      const focusHit = focusErrorRadius <= 1;
      targetObservationCount += 1;
      if (visible) visibleTargetCount += 1;
      if (focusHit) focusHitCount += 1;
      if (targets.length === 1) {
        if (visible) singleTargetVisibleCount += 1;
        if (focusHit) singleTargetFocusHitCount += 1;
      } else if (targets.length === 2) {
        dualTargetObservationCount += 1;
        if (focusHit) dualTargetFocusHitCount += 1;
      }
      const wasHit = previouslyHit.get(target.slot) ?? false;
      if (!focusHit && wasHit && !missStartedAt.has(target.slot)) missStartedAt.set(target.slot, frame.timestampUs);
      if (focusHit && missStartedAt.has(target.slot)) {
        reacquisitionDurationsMs.push((frame.timestampUs - missStartedAt.get(target.slot)!) / 1000);
        missStartedAt.delete(target.slot);
      }
      previouslyHit.set(target.slot, focusHit);
      if (Number.isFinite(focusErrorRadius)) errors.push(focusErrorRadius);
      return { slot: target.slot, visible, focusHit, focusErrorRadius };
    });
    const allTargetsVisible = targetDetails.length > 0 && targetDetails.every((target) => target.visible);
    if (allTargetsVisible) allTargetsVisibleFrameCount += 1;
    if (targetDetails.length === 2) {
      dualTargetFrameCount += 1;
      if (allTargetsVisible) dualTargetAllVisibleFrameCount += 1;
    }
    if (targetDetails.length === 1) singleTargetFrameCount += 1;
    const primaryViewport = frame.viewports[0];
    if (primaryViewport) {
      const center = {
        x: primaryViewport.x + primaryViewport.width / 2,
        y: primaryViewport.y + primaryViewport.height / 2,
        timestampUs: frame.timestampUs,
      };
      if (previousCenter && center.timestampUs > previousCenter.timestampUs) {
        const dt = (center.timestampUs - previousCenter.timestampUs) / 1_000_000;
        const vx = ((center.x - previousCenter.x) * input.sourceWidth) / Math.max(1, Math.min(input.sourceWidth, input.sourceHeight)) / dt;
        const vy = ((center.y - previousCenter.y) * input.sourceHeight) / Math.max(1, Math.min(input.sourceWidth, input.sourceHeight)) / dt;
        centerVelocities.push(Math.hypot(vx, vy));
        if (previousVelocity) {
          const velocityDt = (center.timestampUs - previousVelocity.timestampUs) / 1_000_000;
          if (velocityDt > 0) centerAccelerations.push(Math.hypot(vx - previousVelocity.x, vy - previousVelocity.y) / velocityDt);
        }
        previousVelocity = { x: vx, y: vy, timestampUs: center.timestampUs };
      }
      previousCenter = center;
    }
    details.push({
      timestampUs: frame.timestampUs,
      targetCount: targetDetails.length,
      allTargetsVisible,
      viewports: frame.viewports,
      layoutMode,
      targets: targetDetails,
    });
  }

  errors.sort((a, b) => a - b);
  const frameCount = input.frames.length;
  const mean = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
  const sortedAccelerations = [...centerAccelerations].sort((a, b) => a - b);
  const meanVelocity = centerVelocities.length
    ? centerVelocities.reduce((sum, value) => sum + value, 0) / centerVelocities.length
    : null;
  const meanReacquisitionMs = reacquisitionDurationsMs.length
    ? reacquisitionDurationsMs.reduce((sum, value) => sum + value, 0) / reacquisitionDurationsMs.length
    : null;
  return {
    metrics: {
      frameCount,
      targetObservationCount,
      visibleTargetCount,
      allTargetsVisibleFrameCount,
      focusHitCount,
      dualTargetFrameCount,
      dualTargetAllVisibleFrameCount,
      targetVisibilityRate: targetObservationCount ? visibleTargetCount / targetObservationCount : 0,
      allTargetsVisibleFrameRate: frameCount ? allTargetsVisibleFrameCount / frameCount : 0,
      focusHitRate: targetObservationCount ? focusHitCount / targetObservationCount : 0,
      dualTargetAllVisibleRate: dualTargetFrameCount
        ? dualTargetAllVisibleFrameCount / dualTargetFrameCount
        : null,
      meanFocusErrorRadius: mean,
      medianFocusErrorRadius: quantile(errors, 0.5),
      p95FocusErrorRadius: quantile(errors, 0.95),
      singleTargetFrameCount,
      singleTargetVisibilityRate: singleTargetFrameCount ? singleTargetVisibleCount / singleTargetFrameCount : null,
      singleTargetFocusHitRate: singleTargetFrameCount ? singleTargetFocusHitCount / singleTargetFrameCount : null,
      dualTargetFocusHitRate: dualTargetObservationCount ? dualTargetFocusHitCount / dualTargetObservationCount : null,
      layoutModeFrameCounts,
      layoutModeRates: {
        "single-crop": frameCount ? layoutModeFrameCounts["single-crop"] / frameCount : 0,
        split: frameCount ? layoutModeFrameCounts.split / frameCount : 0,
        contain: frameCount ? layoutModeFrameCounts.contain / frameCount : 0,
      },
      meanViewportCenterVelocity: meanVelocity,
      p95ViewportCenterAcceleration: quantile(sortedAccelerations, 0.95),
      meanFocusReacquisitionMs: meanReacquisitionMs,
    },
    details,
  };
}
