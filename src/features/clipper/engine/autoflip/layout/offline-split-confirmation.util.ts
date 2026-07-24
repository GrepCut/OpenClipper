import type { ClipperLayoutSample } from "../../../shared/smart-crop.util";
import type { VisibilityVariant } from "../../types/autoflip-layout.types";

const EPSILON = 1e-9;

function stableSplitVariant(sample: ClipperLayoutSample): VisibilityVariant | undefined {
  // A controller hold deliberately reuses old panels while vision is missing.
  // It is continuity output, not fresh evidence that may confirm or extend an
  // offline split segment.
  if (sample.reasonCodes?.includes("stable-split-dropout-hold")) return undefined;
  return sample.candidateVariants?.find((variant) =>
    (variant.kind === "stable-split-v2" || variant.kind === "stable-split-v3" || variant.kind === "stable-split-3")
    && variant.viewports.length >= 2);
}

function appendReason(sample: ClipperLayoutSample, reasonCode: string): void {
  if (!(sample.reasonCodes ?? []).includes(reasonCode)) {
    sample.reasonCodes = [...(sample.reasonCodes ?? []), reasonCode];
  }
}

function promoteStableSplit(sample: ClipperLayoutSample, reasonCode: string, split = stableSplitVariant(sample)!): void {
  persistStableSplitCandidate(sample, split, reasonCode);
  sample.mode = "split";
  sample.strategy = "semantic-split";
  sample.viewports = split.viewports.map((viewport) => ({ ...viewport }));
  sample.selectedRequiredCoverage = [...split.requiredCoverage];
  sample.panelSubjects = split.panelSubjects?.map((subject) => ({ id: subject.id, focusBox: { ...subject.focusBox } }));
}

function persistStableSplitCandidate(sample: ClipperLayoutSample, split: VisibilityVariant, reasonCode: string): void {
  sample.candidateMode = "split";
  sample.candidateViewports = split.viewports.map((viewport) => ({ ...viewport }));
  if (!stableSplitVariant(sample)) {
    sample.candidateVariants = [...(sample.candidateVariants ?? []), {
      kind: split.kind,
      mode: "split",
      viewports: split.viewports.map((viewport) => ({ ...viewport })),
      requiredCoverage: [...split.requiredCoverage],
      panelSubjects: split.panelSubjects?.map((subject) => ({ id: subject.id, focusBox: { ...subject.focusBox } })),
    }];
  }
  appendReason(sample, reasonCode);
}

function splitIdentityKey(sample: ClipperLayoutSample): string {
  return [...sample.requiredRegionIds].sort().join("|");
}

/**
 * Tracker IDs can change while the two speakers stay in their left/right
 * positions. Prefer ID continuity, then require corresponding rendered
 * panels to overlap. This is scale-aware and avoids model-specific distance
 * tolerances.
 */
function compatibleSplitBoundaries(left: ClipperLayoutSample, right: ClipperLayoutSample): boolean {
  const leftSplit = stableSplitVariant(left);
  const rightSplit = stableSplitVariant(right);
  if (!leftSplit || !rightSplit || leftSplit.viewports.length !== rightSplit.viewports.length) return false;
  const leftOwners = leftSplit.panelSubjects;
  const rightOwners = rightSplit.panelSubjects;
  // A bridged hole is safe when every panel belongs to the same speaker.
  // Prefer exact owner ID continuity; if tracker IDs churned, require spatial panel continuity.
  if (leftOwners && rightOwners && leftOwners.length === rightOwners.length) {
    if (leftOwners.every((owner, index) => owner.id === rightOwners[index]?.id)) {
      return true;
    }
  }
  if (splitIdentityKey(left) === splitIdentityKey(right)) return true;
  const sharedIds = left.requiredRegionIds.filter((id) => right.requiredRegionIds.includes(id));
  if (sharedIds.length > 0) return true;
  return leftSplit.viewports.every((leftPanel, index) => {
    const rightPanel = rightSplit.viewports[index]!;
    const overlapWidth = Math.max(0, Math.min(leftPanel.x + leftPanel.width, rightPanel.x + rightPanel.width)
      - Math.max(leftPanel.x, rightPanel.x));
    const overlapHeight = Math.max(0, Math.min(leftPanel.y + leftPanel.height, rightPanel.y + rightPanel.height)
      - Math.max(leftPanel.y, rightPanel.y));
    return overlapWidth * overlapHeight > EPSILON;
  });
}

function interpolateSplit(left: VisibilityVariant, right: VisibilityVariant, progress: number): VisibilityVariant {
  const viewports = left.viewports.map((leftPanel, index) => {
    const rightPanel = right.viewports[index]!;
    return {
      x: leftPanel.x + (rightPanel.x - leftPanel.x) * progress,
      y: leftPanel.y + (rightPanel.y - leftPanel.y) * progress,
      width: leftPanel.width + (rightPanel.width - leftPanel.width) * progress,
      height: leftPanel.height + (rightPanel.height - leftPanel.height) * progress,
    };
  });
  return {
    kind: left.kind,
    mode: "split",
    viewports,
    requiredCoverage: left.requiredCoverage.map((value, index) =>
      Math.min(value, right.requiredCoverage[index] ?? value)),
    panelSubjects: left.panelSubjects?.map((subject) => ({ id: subject.id, focusBox: { ...subject.focusBox } })),
  };
}

/**
 * Layout analysis is offline, so the entry debounce is evidence gathering,
 * not a reason to leave the first confirmed seconds as a bad single crop.
 * Once a continuous stable-split run later enters split, backfill its pending
 * prefix from the already persisted split candidate geometry.
 */
export function confirmOfflineSplitEntries(samples: ClipperLayoutSample[]): ClipperLayoutSample[] {
  const confirmed = samples.map((sample) => ({
    ...sample,
    viewports: sample.viewports.map((viewport) => ({ ...viewport })),
    candidateViewports: sample.candidateViewports?.map((viewport) => ({ ...viewport })),
  }));
  let start = 0;
  while (start < confirmed.length) {
    const initial = stableSplitVariant(confirmed[start]!);
    if (!initial) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < confirmed.length && !confirmed[end]!.cut && stableSplitVariant(confirmed[end]!)) end++;
    const firstSelected = confirmed.slice(start, end).findIndex((sample) =>
      sample.mode === "split" && sample.viewports.length >= 2);
    if (firstSelected >= 0) {
      for (let index = start; index < end; index++) {
        const sample = confirmed[index]!;
        if (sample.mode !== "split" || sample.viewports.length < 2) {
          promoteStableSplit(sample, "offline-split-confirmed");
        }
      }
    }
    start = end;
  }
  return confirmed;
}

/**
 * Morphological closing for the discrete layout mode. A brief baseline hole
 * between matching stable splits is detector noise, not an editorial cut.
 * Fill it only when every missing sample still has matching split geometry.
 */
export function bridgeTransientSplitGaps(
  samples: ClipperLayoutSample[],
  /** Use the controller's exit confirmation, rather than an unrelated smoothing constant. */
  splitExitStableSec: number,
): ClipperLayoutSample[] {
  const denoised = samples.map((sample) => ({
    ...sample,
    viewports: sample.viewports.map((viewport) => ({ ...viewport })),
    candidateViewports: sample.candidateViewports?.map((viewport) => ({ ...viewport })),
  }));
  let cursor = 1;
  while (cursor < denoised.length - 1) {
    if (stableSplitVariant(denoised[cursor]!) || denoised[cursor]!.cut) {
      cursor++;
      continue;
    }
    const start = cursor;
    while (cursor < denoised.length && !stableSplitVariant(denoised[cursor]!) && !denoised[cursor]!.cut) cursor++;
    const end = cursor;
    const left = denoised[start - 1]!;
    const right = denoised[end];
    const gapElapsed = right == null
      ? Number.POSITIVE_INFINITY
      : right.t - left.t;
    const compatible = right != null
      && stableSplitVariant(left) != null
      && stableSplitVariant(right) != null
      && gapElapsed <= splitExitStableSec + EPSILON
      && compatibleSplitBoundaries(left, right);
    if (compatible) {
      const leftSplit = stableSplitVariant(left)!;
      const rightSplit = stableSplitVariant(right)!;
      const count = end - start;
      for (let index = start; index < end; index++) {
        const progress = (index - start + 1) / (count + 1);
        persistStableSplitCandidate(
          denoised[index]!,
          interpolateSplit(leftSplit, rightSplit, progress),
          "transient-baseline-gap-bridged",
        );
      }
    }
    cursor = Math.max(end + 1, start + 1);
  }
  return confirmOfflineSplitEntries(denoised);
}
