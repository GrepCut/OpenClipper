import type { ClipperLayoutSample } from "../../../shared/smart-crop.util";

const MINIMUM_SPLIT_DURATION_SEC = 2;
const MINIMUM_ORPHAN_SPLIT_DURATION_SEC = 0.75;
const HIGH_CONFIDENCE_SPLIT_THRESHOLD = 0.8;
const UNSAFE_BASELINE_COVERAGE = 0.85;

type SplitRunSource = "selected" | "candidate";

function hasSplit(sample: ClipperLayoutSample, source: SplitRunSource): boolean {
  return source === "selected"
    ? sample.mode === "split" && sample.viewports.length >= 2
    : sample.candidateMode === "split" && (sample.candidateViewports?.length ?? 0) >= 2;
}

function hasStableSplitVariant(sample: ClipperLayoutSample): boolean {
  return sample.candidateVariants?.some((variant) =>
    variant.kind === "stable-split-v2"
      || variant.kind === "stable-split-v3"
      || variant.kind === "stable-split-3") ?? false;
}

function baselineMissesRequiredTarget(sample: ClipperLayoutSample): boolean {
  const coverage = sample.baselineRequiredCoverage;
  return coverage?.some((value) => value < UNSAFE_BASELINE_COVERAGE) ?? false;
}

/**
 * Short splits normally create an unpleasant flash.  A candidate that has
 * already passed the controller's identity/stability gates and materially
 * rescues an uncovered person is editorially stronger than that duration
 * guard, so it must survive in both preview and export.
 */
function isHighConfidenceSplitSample(sample: ClipperLayoutSample): boolean {
  return sample.requiredRegionIds.length >= 2
    && sample.targetEvidence?.status === "qualified"
    && (sample.decisionConfidence ?? 0) >= HIGH_CONFIDENCE_SPLIT_THRESHOLD
    && hasStableSplitVariant(sample)
    && baselineMissesRequiredTarget(sample);
}

function splitRun(samples: ClipperLayoutSample[], index: number, source: SplitRunSource): ClipperLayoutSample[] {
  if (!samples[index] || !hasSplit(samples[index]!, source)) return [];
  let start = index;
  while (start > 0 && hasSplit(samples[start - 1]!, source) && !samples[start]!.cut) start--;
  let end = index + 1;
  while (end < samples.length && hasSplit(samples[end]!, source) && !samples[end]!.cut) end++;
  return samples.slice(start, end);
}

function isShortSplitRun(samples: ClipperLayoutSample[], index: number, source: SplitRunSource): boolean {
  const run = splitRun(samples, index, source);
  if (!run.length) return false;
  const endTime = run.at(-1)!.t;
  return endTime - run[0]!.t < MINIMUM_SPLIT_DURATION_SEC;
}

/** True when the selected split at index is shorter than the normal two-second guard. */
export function isShortSelectedSplitRun(samples: ClipperLayoutSample[], index: number): boolean {
  return isShortSplitRun(samples, index, "selected");
}

/** True when a persisted candidate split is shorter than the normal two-second guard. */
export function isShortCandidateSplitRun(samples: ClipperLayoutSample[], index: number): boolean {
  return isShortSplitRun(samples, index, "candidate");
}

/**
 * Applies the duration rule to a selected split or to a persisted split
 * candidate. Candidate support lets new code repair analyses written before
 * this policy without re-running the vision models.
 */
export function shouldKeepShortSplitRun(samples: ClipperLayoutSample[], index: number): boolean {
  const source: SplitRunSource = hasSplit(samples[index]!, "selected") ? "selected" : "candidate";
  const run = splitRun(samples, index, source);
  if (!run.length) return false;
  const endTime = run.at(-1)!.t;
  // A half-second isolated split reads as a flash even if the detector was
  // confident. Bridged gaps are handled before this policy, so this only
  // removes genuinely orphaned bursts.
  if (endTime - run[0]!.t < MINIMUM_ORPHAN_SPLIT_DURATION_SEC) return false;
  if (endTime - run[0]!.t >= MINIMUM_SPLIT_DURATION_SEC) return true;
  return run.every(isHighConfidenceSplitSample);
}

/** Adds the persisted explanation only once, regardless of planner or render path. */
export function withShortSplitConfidenceReason(sample: ClipperLayoutSample): ClipperLayoutSample {
  const reasonCodes = sample.reasonCodes ?? [];
  return reasonCodes.includes("short-split-confidence-rescue")
    ? sample
    : { ...sample, reasonCodes: [...reasonCodes, "short-split-confidence-rescue"] };
}

/** Restores a previously pruned high-confidence split from its persisted candidate geometry. */
export function restoreShortSplitCandidate(sample: ClipperLayoutSample): ClipperLayoutSample | null {
  if (sample.candidateMode !== "split" || (sample.candidateViewports?.length ?? 0) < 2) return null;
  return withShortSplitConfidenceReason({
    ...sample,
    mode: "split",
    strategy: "semantic-split",
    viewports: sample.candidateViewports!.map((viewport) => ({ ...viewport })),
  });
}
