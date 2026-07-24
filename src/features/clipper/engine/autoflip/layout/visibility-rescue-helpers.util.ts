import type {
  ClipperLayoutMode,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../../shared/smart-crop.util";
import { requiredRegions } from "./arbiter.util";
import type { VisibilityControllerState, VisibilityVariant } from "../../types/autoflip-layout.types";
import { coverage } from "./visibility-envelope.util";

const EPSILON = 1e-9;
const PAIR_SLOT_MAX_CENTER_DELTA = 0.13;
const PAIR_SLOT_MAX_VERTICAL_DELTA = 0.25;

export function hasIndependentEvidence(region: ImportanceRegion): boolean {
  const semantic = new Set(region.sources.filter((source) => source !== "motion"));
  return !region.predicted
    && region.confidence >= 0.75
    && !region.identityAmbiguous
    && (semantic.has("person") || semantic.has("pose") || semantic.has("face") || semantic.has("head"));
}

export function stablePair(
  samples: ImportanceRegionSample[],
  index: number,
  regions: ImportanceRegion[],
  minimumSamples: number,
): boolean {
  if (regions.length !== 2) return false;
  const current = requiredRegions(samples[index] ?? { time: 0, regions: [] }).filter(hasIndependentEvidence);
  if (current.length !== 2 || !pairObservationMatches(regions, current)) return false;
  // Analysis is offline. Confirm against either the preceding or following
  // eight-sample window, so evidence gathering does not delay the final edit.
  // Five matching observations tolerate detector dropouts without allowing a
  // single frame to create a split.
  const minimumObserved = Math.max(2, Math.ceil(minimumSamples * 0.625));
  return matchingPairObservations(samples, index, regions, minimumSamples, -1) >= minimumObserved
    || matchingPairObservations(samples, index, regions, minimumSamples, 1) >= minimumObserved;
}

function boxCenter(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function orderedPairByPosition(regions: ImportanceRegion[]): [ImportanceRegion, ImportanceRegion] | null {
  if (regions.length !== 2) return null;
  const ordered = [...regions].sort((left, right) => boxCenter(left.contentBox).x - boxCenter(right.contentBox).x);
  return [ordered[0]!, ordered[1]!];
}

function pairObservationMatches(reference: ImportanceRegion[], observed: ImportanceRegion[]): boolean {
  const referenceKey = reference.map((region) => region.id).sort().join("|");
  const observedKey = observed.map((region) => region.id).sort().join("|");
  if (referenceKey === observedKey) return true;
  const referenceSlots = orderedPairByPosition(reference);
  const observedSlots = orderedPairByPosition(observed);
  if (!referenceSlots || !observedSlots) return false;
  return referenceSlots.every((slot, slotIndex) => {
    const candidate = observedSlots[slotIndex]!;
    if (slot.id === candidate.id) return true;
    const expected = boxCenter(slot.contentBox);
    const actual = boxCenter(candidate.contentBox);
    return Math.abs(expected.x - actual.x) <= PAIR_SLOT_MAX_CENTER_DELTA
      && Math.abs(expected.y - actual.y) <= PAIR_SLOT_MAX_VERTICAL_DELTA;
  });
}

function matchingPairObservations(
  samples: ImportanceRegionSample[],
  index: number,
  reference: ImportanceRegion[],
  maximumSamples: number,
  direction: -1 | 1,
): number {
  let observed = 0;
  for (let offset = 0; offset < maximumSamples; offset++) {
    const cursor = index + offset * direction;
    if (cursor < 0 || cursor >= samples.length) break;
    const sample = samples[cursor]!;
    if (offset > 0) {
      const boundary = direction < 0 ? samples[cursor + 1] : sample;
      if (boundary?.cut) break;
    }
    const required = requiredRegions(sample).filter(hasIndependentEvidence);
    if (required.length === 2 && pairObservationMatches(reference, required)) observed++;
  }
  return observed;
}

export function stableTriple(
  samples: ImportanceRegionSample[],
  index: number,
  ids: string[],
  minimumSamples: number,
): boolean {
  if (ids.length !== 3) return false;
  const key = [...ids].sort().join("|");
  let observed = 0;
  for (let cursor = index; cursor >= 0 && observed < minimumSamples; cursor--) {
    const sample = samples[cursor]!;
    if (cursor < index && (samples[cursor + 1]?.cut || sample.cut)) break;
    const required = requiredRegions(sample).filter(hasIndependentEvidence);
    if (required.length !== 3 || required.map((region) => region.id).sort().join("|") !== key) break;
    observed++;
  }
  return observed >= minimumSamples;
}

export function similarlyImportantPeople(sample: ImportanceRegionSample): number {
  const human = new Set(["face", "head", "speaker", "person"]);
  const candidates = sample.regions.filter((region) => !region.predicted && human.has(region.kind));
  if (candidates.length < 3) return candidates.length;
  const strongest = Math.max(...candidates.map((region) => region.importanceScore));
  return candidates.filter((region) => region.importanceScore >= strongest * 0.8).length;
}

export function edgeRisk(
  samples: ImportanceRegionSample[],
  index: number,
  regions: ImportanceRegion[],
  fraction: number,
): boolean {
  const previous = new Map<string, ImportanceRegion>();
  if (index > 0 && !samples[index]?.cut) {
    for (const region of samples[index - 1]!.regions) previous.set(region.id, region);
  }
  return regions.some((region) => {
    const center = region.contentBox.x + region.contentBox.width / 2;
    const prior = previous.get(region.id);
    const priorCenter = prior ? prior.contentBox.x + prior.contentBox.width / 2 : center;
    return (center <= fraction && center < priorCenter - EPSILON)
      || (center >= 1 - fraction && center > priorCenter + EPSILON);
  });
}

export function orderedPair(regions: ImportanceRegion[], state: VisibilityControllerState): ImportanceRegion[] {
  if (state.panelOrder.length === 2) {
    const ordered = state.panelOrder
      .map((id) => regions.find((region) => region.id === id))
      .filter((region): region is ImportanceRegion => region != null);
    if (ordered.length === 2) return ordered;
  }
  const ordered = [...regions].sort((a, b) =>
    (a.contentBox.x + a.contentBox.width / 2) - (b.contentBox.x + b.contentBox.width / 2));
  state.panelOrder = ordered.map((region) => region.id);
  return ordered;
}

/** Keep the editorial primary first; the lower/right pair is spatially stable. */
export function orderedTriple(regions: ImportanceRegion[], state: VisibilityControllerState): ImportanceRegion[] {
  const primary = regions.find((region) => region.role === "primary")
    ?? [...regions].sort((a, b) => b.importanceScore - a.importanceScore)[0]!;
  const others = regions.filter((region) => region.id !== primary.id);
  if (state.panelOrder.length === 3 && state.panelOrder[0] === primary.id) {
    const ordered = state.panelOrder
      .map((id) => regions.find((region) => region.id === id))
      .filter((region): region is ImportanceRegion => region != null);
    if (ordered.length === 3) return ordered;
  }
  others.sort((a, b) =>
    (a.contentBox.x + a.contentBox.width / 2) - (b.contentBox.x + b.contentBox.width / 2));
  const ordered = [primary, ...others];
  state.panelOrder = ordered.map((region) => region.id);
  return ordered;
}

export function variant(
  kind: VisibilityVariant["kind"],
  mode: ClipperLayoutMode,
  viewports: NormalizedBox[],
  envelopes: ImportanceRegion[],
  panelSubjects = envelopes,
): VisibilityVariant {
  return {
    kind, mode, viewports, requiredCoverage: coverage(viewports, envelopes),
    panelSubjects: mode === "split"
      ? panelSubjects.map((region) => ({ id: region.id, focusBox: { ...region.box } }))
      : undefined,
  };
}

export function minimumCoverage(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

export const VISIBILITY_EPSILON = EPSILON;
