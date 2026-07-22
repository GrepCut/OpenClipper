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
  ids: string[],
  minimumSamples: number,
): boolean {
  if (ids.length !== 2) return false;
  const key = [...ids].sort().join("|");
  let observed = 0;
  for (let cursor = index; cursor >= 0 && observed < minimumSamples; cursor--) {
    const sample = samples[cursor]!;
    if (cursor < index && (samples[cursor + 1]?.cut || sample.cut)) break;
    const required = requiredRegions(sample).filter(hasIndependentEvidence);
    if (required.length !== 2 || required.map((region) => region.id).sort().join("|") !== key) break;
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

export function variant(
  kind: VisibilityVariant["kind"],
  mode: ClipperLayoutMode,
  viewports: NormalizedBox[],
  envelopes: ImportanceRegion[],
): VisibilityVariant {
  return { kind, mode, viewports, requiredCoverage: coverage(viewports, envelopes) };
}

export function minimumCoverage(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

export const VISIBILITY_EPSILON = EPSILON;
