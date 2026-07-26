import { evaluateGroundTruth } from "./ground-truth.util";
import type { LegacyBenchmarkMetrics, TestKeyframe, TestTarget } from "../test.types";
import type { ClipperLayoutMode } from "../../clipper/shared/smart-crop.util";
import { COVERAGE_HIT_THRESHOLD, coverageOfTarget } from "./target-geometry.util";

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
  reasonCodes?: string[];
  requiredRegionIds?: string[];
  subjectDisplayHeightFractions?: number[];
  cut?: boolean;
}

export interface BenchmarkTargetDetail {
  slot: 0 | 1;
  coverageFraction: number;
  coverageHit: boolean;
}

export interface BenchmarkFrameDetail {
  timestampUs: number;
  targetCount: number;
  allTargetsCovered: boolean;
  viewports: NormalizedViewport[];
  layoutMode: ClipperLayoutMode;
  targets: BenchmarkTargetDetail[];
  reasonCodes?: string[];
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
}): { metrics: LegacyBenchmarkMetrics; details: BenchmarkFrameDetail[] } {
  let targetObservationCount = 0;
  let coveredTargetCount = 0;
  let allTargetsCoveredFrameCount = 0;
  let coverageHitCount = 0;
  let dualTargetFrameCount = 0;
  let dualTargetAllCoveredFrameCount = 0;
  let singleTargetFrameCount = 0;
  let singleTargetCoverageSum = 0;
  let singleTargetCoverageHitCount = 0;
  let dualTargetObservationCount = 0;
  let dualTargetCoverageHitCount = 0;
  const coverages: number[] = [];
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
  let previousLayoutMode: ClipperLayoutMode | null = null;
  let modeSwitchCount = 0;
  let firstTimestampUs: number | null = null;
  let lastTimestampUs: number | null = null;
  const displayHeights: number[] = [];

  for (const frame of input.frames) {
    const layoutMode = frame.layoutMode ?? (frame.viewports.length > 1 ? "split" : "single-crop");
    firstTimestampUs ??= frame.timestampUs;
    lastTimestampUs = frame.timestampUs;
    if (!frame.cut && previousLayoutMode != null && previousLayoutMode !== layoutMode) modeSwitchCount++;
    previousLayoutMode = layoutMode;
    displayHeights.push(...(frame.subjectDisplayHeightFractions ?? []).filter(Number.isFinite));
    layoutModeFrameCounts[layoutMode] += 1;
    const targets = evaluateGroundTruth(input.keyframes, frame.timestampUs);
    const targetDetails = targets.map<BenchmarkTargetDetail>((target) => {
      const coverageFraction = coverageOfTarget(frame.viewports, target);
      const coverageHit = coverageFraction >= COVERAGE_HIT_THRESHOLD;
      targetObservationCount += 1;
      coveredTargetCount += coverageFraction;
      if (coverageHit) coverageHitCount += 1;
      if (targets.length === 1) {
        singleTargetCoverageSum += coverageFraction;
        if (coverageHit) singleTargetCoverageHitCount += 1;
      } else if (targets.length === 2) {
        dualTargetObservationCount += 1;
        if (coverageHit) dualTargetCoverageHitCount += 1;
      }
      const wasHit = previouslyHit.get(target.slot) ?? false;
      if (!coverageHit && wasHit && !missStartedAt.has(target.slot)) missStartedAt.set(target.slot, frame.timestampUs);
      if (coverageHit && missStartedAt.has(target.slot)) {
        reacquisitionDurationsMs.push((frame.timestampUs - missStartedAt.get(target.slot)!) / 1000);
        missStartedAt.delete(target.slot);
      }
      previouslyHit.set(target.slot, coverageHit);
      if (Number.isFinite(coverageFraction)) coverages.push(coverageFraction);
      return { slot: target.slot, coverageFraction, coverageHit };
    });
    const allTargetsCovered = targetDetails.length > 0 && targetDetails.every((target) => target.coverageHit);
    if (allTargetsCovered) allTargetsCoveredFrameCount += 1;
    if (targetDetails.length === 2) {
      dualTargetFrameCount += 1;
      if (allTargetsCovered) dualTargetAllCoveredFrameCount += 1;
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
      allTargetsCovered,
      viewports: frame.viewports,
      layoutMode,
      targets: targetDetails,
      reasonCodes: frame.reasonCodes,
    });
  }

  coverages.sort((a, b) => a - b);
  const frameCount = input.frames.length;
  const meanCoverage = targetObservationCount ? coveredTargetCount / targetObservationCount : 0;
  const sortedAccelerations = [...centerAccelerations].sort((a, b) => a - b);
  const sortedVelocities = [...centerVelocities].sort((a, b) => a - b);
  displayHeights.sort((a, b) => a - b);
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
      coveredTargetCount,
      allTargetsCoveredFrameCount,
      coverageHitCount,
      dualTargetFrameCount,
      dualTargetAllCoveredFrameCount,
      meanCoverageFraction: meanCoverage,
      allTargetsCoveredFrameRate: frameCount ? allTargetsCoveredFrameCount / frameCount : 0,
      coverageHitRate: targetObservationCount ? coverageHitCount / targetObservationCount : 0,
      dualTargetAllCoveredRate: dualTargetFrameCount
        ? dualTargetAllCoveredFrameCount / dualTargetFrameCount
        : null,
      medianCoverageFraction: quantile(coverages, 0.5),
      p5CoverageFraction: quantile(coverages, 0.05),
      singleTargetFrameCount,
      singleTargetMeanCoverageFraction: singleTargetFrameCount ? singleTargetCoverageSum / singleTargetFrameCount : null,
      singleTargetCoverageHitRate: singleTargetFrameCount ? singleTargetCoverageHitCount / singleTargetFrameCount : null,
      dualTargetCoverageHitRate: dualTargetObservationCount ? dualTargetCoverageHitCount / dualTargetObservationCount : null,
      layoutModeFrameCounts,
      layoutModeRates: {
        "single-crop": frameCount ? layoutModeFrameCounts["single-crop"] / frameCount : 0,
        split: frameCount ? layoutModeFrameCounts.split / frameCount : 0,
        contain: frameCount ? layoutModeFrameCounts.contain / frameCount : 0,
      },
      meanViewportCenterVelocity: meanVelocity,
      p95ViewportCenterVelocity: quantile(sortedVelocities, 0.95),
      p95ViewportCenterAcceleration: quantile(sortedAccelerations, 0.95),
      meanCoverageReacquisitionMs: meanReacquisitionMs,
      modeSwitchesPerMinute: modeSwitchCount / Math.max(
        1 / 60,
        ((lastTimestampUs ?? 0) - (firstTimestampUs ?? 0)) / 60_000_000,
      ),
      containDutyCycle: frameCount ? layoutModeFrameCounts.contain / frameCount : 0,
      medianSubjectDisplayHeightFraction: quantile(displayHeights, 0.5),
      p10SubjectDisplayHeightFraction: quantile(displayHeights, 0.1),
    },
    details,
  };
}
