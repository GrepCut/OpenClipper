import type { ImportanceRegion, ImportanceRegionSample, NormalizedBox, SubjectDetectionSample } from "../../../clipper/shared/smart-crop.util";
import { COVERAGE_HIT_THRESHOLD, coverageOfTarget, targetBox } from "../target-geometry.util";
import { coveredFraction } from "../../../clipper/engine/autoflip/layout";
import type { TestKeyframe, TestTarget } from "../../test.types";
import { evaluateGroundTruth } from "../ground-truth.util";
import type { BenchmarkFrameInput } from "../metrics.util";
import type { ReplayedSample } from "./replay-engine.util";

export type MissCategory = "no-evidence" | "identity-mismatch" | "layout-uncovered" | "late-transition" | "interpolation-loss";

export interface OracleCeiling {
  visible: number;
  observations: number;
  visibility: number;
  dualFrames: number;
  dualAllVisibleFrames: number;
  dualVisibility: number | null;
}

export interface OracleBreakdownRow {
  category: MissCategory | "visible";
  targetMode: "single" | "dual";
  scene: number;
  layoutMode: string;
  detectorSource: string;
}

export interface ReplayOracleReport {
  detectionOracle: OracleCeiling;
  identityOracle: OracleCeiling;
  layoutOracle: OracleCeiling;
  timingOracle: OracleCeiling;
  interpolationOracle: OracleCeiling;
  missLedger: Record<MissCategory, number>;
  reasonTransitions: Record<string, Record<MissCategory, number>>;
  breakdown: OracleBreakdownRow[];
  evidenceSource: "raw-detector-samples" | "ranked-importance-fallback";
}

const EPSILON = 1e-9;

function coversTarget(box: NormalizedBox, target: TestTarget): boolean {
  return coveredFraction(box, targetBox(target)) >= COVERAGE_HIT_THRESHOLD - EPSILON;
}

function visible(viewports: NormalizedBox[], target: TestTarget): boolean {
  return coverageOfTarget(viewports, target) >= COVERAGE_HIT_THRESHOLD - EPSILON;
}

function preceding<T>(items: T[], predicate: (item: T) => number, time: number): number {
  let low = 0;
  let high = items.length - 1;
  let answer = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (predicate(items[middle]!) <= time + EPSILON) { answer = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return answer;
}

function observedEvidence(sample: ImportanceRegionSample | undefined): ImportanceRegion[] {
  const detectorEvidence = new Set(["person", "pose", "face", "head"]);
  return (sample?.regions ?? []).filter((region) =>
    !region.predicted
    && !region.identityAmbiguous
    && region.sources.some((source) => detectorEvidence.has(source)));
}

function sourceOf(regions: ImportanceRegion[], target: TestTarget): string {
  const sources = regions.filter((region) => coversTarget(region.contentBox, target)).flatMap((region) => region.sources);
  return [...new Set(sources)].sort().join("+") || "none";
}

function makeAccumulator() {
  return { visible: 0, observations: 0, visibility: 0, dualFrames: 0, dualAllVisibleFrames: 0, dualVisibility: null as number | null };
}

function finish(value: ReturnType<typeof makeAccumulator>): OracleCeiling {
  return {
    ...value,
    visibility: value.observations ? value.visible / value.observations : 0,
    dualVisibility: value.dualFrames ? value.dualAllVisibleFrames / value.dualFrames : null,
  };
}

/** Benchmark-only GT attribution. This module is intentionally outside every runtime import path. */
export function calculateReplayOracles(input: {
  keyframes: TestKeyframe[];
  importanceSamples: ImportanceRegionSample[];
  replaySamples: ReplayedSample[];
  frames: BenchmarkFrameInput[];
  subjectSamples?: SubjectDetectionSample[];
}): ReplayOracleReport {
  const detection = makeAccumulator();
  const identity = makeAccumulator();
  const layout = makeAccumulator();
  const timing = makeAccumulator();
  const interpolation = makeAccumulator();
  const missLedger: Record<MissCategory, number> = {
    "no-evidence": 0,
    "identity-mismatch": 0,
    "layout-uncovered": 0,
    "late-transition": 0,
    "interpolation-loss": 0,
  };
  const reasonTransitions: Record<string, Record<MissCategory, number>> = {};
  const breakdown: OracleBreakdownRow[] = [];
  let scene = 0;
  let previousSampleIndex = -1;

  for (const frame of input.frames) {
    const time = frame.timestampUs / 1_000_000;
    const sampleIndex = preceding(input.replaySamples, (sample) => sample.t, time);
    const replay = input.replaySamples[sampleIndex];
    const importanceIndex = preceding(input.importanceSamples, (sample) => sample.time, time);
    const importance = input.importanceSamples[importanceIndex];
    if (sampleIndex !== previousSampleIndex && replay?.cut) scene++;
    previousSampleIndex = sampleIndex;
    const rawIndex = input.subjectSamples?.length
      ? preceding(input.subjectSamples, (sample) => sample.time, time)
      : -1;
    const raw = rawIndex >= 0 ? input.subjectSamples?.[rawIndex] : undefined;
    const evidence = observedEvidence(importance);
    const requiredIds = new Set(replay?.requiredRegionIds ?? frame.requiredRegionIds ?? []);
    const required = evidence.filter((region) => requiredIds.has(region.id));
    const variants = replay?.candidateVariants ?? [];
    const targets = evaluateGroundTruth(input.keyframes, frame.timestampUs);
    const targetMode = targets.length === 2 ? "dual" : "single";
    const hits = { detection: [] as boolean[], identity: [] as boolean[], layout: [] as boolean[], timing: [] as boolean[], interpolation: [] as boolean[] };

    for (const target of targets) {
      const finalVisible = visible(frame.viewports, target);
      const rawEvidence = raw ? [
        ...raw.detections.filter((item) => item.label.toLowerCase() === "person" && !item.predicted).map((item) => item.box),
        ...(raw.autoflipFaces ?? []).filter((item) => !item.predicted).map((item) => item.box),
        ...(raw.poseSubjects ?? []).filter((item) => !item.predicted).flatMap((item) => [item.box, ...(item.headBox ? [item.headBox] : [])]),
      ] : null;
      const evidenceHit = rawEvidence
        ? rawEvidence.some((box) => coversTarget(box, target))
        : evidence.some((region) => coversTarget(region.contentBox, target));
      const canonicalHit = raw?.canonicalPersons?.some((track) =>
        track.state !== "predicted"
        && !track.identityAmbiguous
        && [track.personBox, track.faceBox, track.poseBox].some((box) => box != null && coversTarget(box, target)));
      const identityHit = canonicalHit ?? required.some((region) => coversTarget(region.contentBox, target));
      const layoutHit = variants.some((variant) => visible(variant.viewports, target));
      const futureHit = [0.2, 0.4, 0.6, 0.8, 1].some((offset) => {
        const futureIndex = preceding(input.replaySamples, (sample) => sample.t, time + offset);
        const future = input.replaySamples[futureIndex];
        return future != null && future.t > time + EPSILON && visible(future.viewports, target);
      });
      const previous = input.replaySamples[sampleIndex];
      const next = input.replaySamples[Math.min(input.replaySamples.length - 1, sampleIndex + 1)];
      const endpointHit = Boolean(previous && next && previous !== next
        && visible(previous.viewports, target) && visible(next.viewports, target));
      hits.detection.push(evidenceHit);
      hits.identity.push(evidenceHit && identityHit);
      hits.layout.push(evidenceHit && identityHit && layoutHit);
      hits.timing.push(evidenceHit && identityHit && (finalVisible || futureHit));
      hits.interpolation.push(evidenceHit && identityHit && (finalVisible || endpointHit));
      if (finalVisible) {
        breakdown.push({ category: "visible", targetMode, scene, layoutMode: frame.layoutMode ?? "single-crop", detectorSource: sourceOf(evidence, target) });
        continue;
      }
      const category: MissCategory = !evidenceHit
        ? "no-evidence"
        : !identityHit
          ? "identity-mismatch"
          : endpointHit
            ? "interpolation-loss"
            : futureHit
              ? "late-transition"
              : "layout-uncovered";
      missLedger[category]++;
      for (const reason of replay?.reasonCodes ?? frame.reasonCodes ?? ["unclassified"]) {
        reasonTransitions[reason] ??= { "no-evidence": 0, "identity-mismatch": 0, "layout-uncovered": 0, "late-transition": 0, "interpolation-loss": 0 };
        reasonTransitions[reason]![category]++;
      }
      breakdown.push({ category, targetMode, scene, layoutMode: frame.layoutMode ?? "single-crop", detectorSource: sourceOf(evidence, target) });
    }
    for (const [key, values] of Object.entries(hits) as Array<[keyof typeof hits, boolean[]]>) {
      const accumulator = key === "detection" ? detection : key === "identity" ? identity : key === "layout" ? layout : key === "timing" ? timing : interpolation;
      accumulator.observations += values.length;
      accumulator.visible += values.filter(Boolean).length;
      if (values.length === 2) {
        accumulator.dualFrames++;
        if (values.every(Boolean)) accumulator.dualAllVisibleFrames++;
      }
    }
  }
  return {
    detectionOracle: finish(detection),
    identityOracle: finish(identity),
    layoutOracle: finish(layout),
    timingOracle: finish(timing),
    interpolationOracle: finish(interpolation),
    missLedger,
    reasonTransitions,
    breakdown,
    evidenceSource: input.subjectSamples?.length ? "raw-detector-samples" : "ranked-importance-fallback",
  };
}
