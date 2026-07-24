import type {
  ImportanceRegion,
  ImportanceRegionKind,
  ImportanceRegionSample,
  ImportanceRegionSource,
  ImportanceRegionTrust,
  ImportanceSignalKind,
  ImportanceSignalSample,
  NormalizedBox,
  TargetEvidence,
} from "../../../shared/smart-crop.util";
import type { KeyFrameSalientInput, SalientRegion, SalientSignalType } from "../../types/autoflip.types";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

interface SignalPolicy {
  kind: ImportanceRegionKind;
  source: ImportanceRegionSource;
  prior: number;
}

const SIGNAL_POLICY: Record<SalientSignalType, SignalPolicy> = {
  face_core: { kind: "face", source: "face", prior: 0.82 },
  face_all: { kind: "face", source: "face", prior: 0.8 },
  face_full: { kind: "head", source: "head", prior: 0.76 },
  pose_head: { kind: "head", source: "pose", prior: 0.7 },
  pose_torso: { kind: "action", source: "pose", prior: 0.58 },
  human: { kind: "person", source: "person", prior: 0.62 },
  pet: { kind: "object", source: "object", prior: 0.58 },
  car: { kind: "object", source: "object", prior: 0.58 },
  object: { kind: "object", source: "object", prior: 0.32 },
  head: { kind: "head", source: "head", prior: 0.82 },
  screen: { kind: "screen", source: "object", prior: 0.82 },
  motion: { kind: "action", source: "motion", prior: 0.66 },
  video_saliency: { kind: "action", source: "video-saliency", prior: 0.86 },
  active_speaker: { kind: "speaker", source: "active-speaker", prior: 0.96 },
};

const EXTERNAL_SIGNAL_TYPE: Record<ImportanceSignalKind, SalientSignalType> = {
  "video-saliency": "video_saliency",
  "active-speaker": "active_speaker",
  head: "head",
  screen: "screen",
  motion: "motion",
};

interface Candidate {
  box: NormalizedBox;
  evidence: number;
  confidence: number;
  detectorConfidence?: number;
  kind: ImportanceRegionKind;
  source: ImportanceRegionSource;
  trackId?: number;
  predicted?: boolean;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
  projectIdentityId?: string;
  trust: ImportanceRegionTrust;
}

interface CandidateCluster {
  candidates: Candidate[];
  trackId?: number;
  projectIdentityId?: string;
}

interface SaliencyStabilityState {
  previous: ImportanceRegion | null;
  consecutive: number;
}

interface TemporalPersonObservation {
  count: number;
  startedAt: number;
  lastObservedAt: number;
}

interface TemporalPersonFallbackState {
  observations: Map<string, TemporalPersonObservation>;
}

// Native subject samples arrive at 5 FPS. Three trustworthy observations
// give a fast-moving rider a usable target in roughly 0.4 seconds without
// promoting a one-off detector hit.
const TEMPORAL_PERSON_MIN_OBSERVATIONS = 3;
const TEMPORAL_PERSON_MIN_SPAN_SEC = 0.35;
const TEMPORAL_PERSON_MAX_GAP_SEC = 0.75;
const TEMPORAL_PERSON_MAX_HOLD_SEC = 1.2;
const TEMPORAL_PERSON_MIN_DETECTOR_CONFIDENCE = 0.25;
const TEMPORAL_PERSON_MIN_ASSOCIATION_CONFIDENCE = 0.6;

function boxArea(box: NormalizedBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(a: NormalizedBox, b: NormalizedBox): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function overlapFractionOfSmaller(a: NormalizedBox, b: NormalizedBox): number {
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? intersectionArea(a, b) / smaller : 0;
}

function intersectionOverUnion(a: NormalizedBox, b: NormalizedBox): number {
  const intersection = intersectionArea(a, b);
  const union = boxArea(a) + boxArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

function unionBoxes(a: NormalizedBox, b: NormalizedBox): NormalizedBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function signalCandidate(region: SalientRegion): Candidate {
  const policy = SIGNAL_POLICY[region.signalType];
  const confidence = clamp01(region.score);
  let evidence = policy.prior * 0.68 + confidence * 0.32;
  if (region.predicted) evidence *= 0.42;
  const centerX = region.box.x + region.box.width / 2;
  const centerDistance = Math.abs(centerX - 0.5) * 2;
  evidence *= 1 - Math.min(0.05, centerDistance * 0.05);
  return {
    box: region.box,
    evidence: clamp01(evidence),
    confidence,
    detectorConfidence: region.detectorConfidence,
    kind: policy.kind,
    source: policy.source,
    trackId: region.trackId,
    predicted: region.predicted,
    associationConfidence: region.associationConfidence,
    identityAmbiguous: region.identityAmbiguous,
    projectIdentityId: region.projectIdentityId,
    trust: region.trust
      ?? (policy.source === "video-saliency"
        ? "video-saliency"
        : policy.kind === "person" || policy.kind === "face" || policy.kind === "head" || policy.kind === "speaker"
          ? "unverified-person"
          : "object"),
  };
}

function belongsToCluster(candidate: Candidate, cluster: CandidateCluster): boolean {
  if (candidate.projectIdentityId != null && cluster.projectIdentityId != null) {
    return candidate.projectIdentityId === cluster.projectIdentityId;
  }
  if (
    candidate.trackId != null
    && cluster.trackId === candidate.trackId
    && !candidate.identityAmbiguous
    && cluster.candidates.every((existing) => !existing.identityAmbiguous)
  ) return true;
  // Face, pose and person detections are tracked by separate native trackers,
  // so their ids are not comparable.  A face contained by a body box is still
  // evidence for one subject, not a second required layout target.
  return cluster.candidates.some((existing) => overlapFractionOfSmaller(candidate.box, existing.box) >= 0.48);
}

function clusterCandidates(regions: SalientRegion[]): CandidateCluster[] {
  const candidates = regions
    // ByteTrack predictions bridge detector cadence and short occlusions. They
    // are only allowed to become targets after the temporal gate below has
    // seen a real observation for the same canonical track.
    .filter((region) => region.box.width > 0 && region.box.height > 0)
    .map(signalCandidate)
    .sort((a, b) => b.evidence - a.evidence);
  const clusters: CandidateCluster[] = [];
  for (const candidate of candidates) {
    const cluster = clusters.find((item) => belongsToCluster(candidate, item));
    if (cluster) {
      cluster.candidates.push(candidate);
      cluster.trackId ??= candidate.trackId;
      cluster.projectIdentityId ??= candidate.projectIdentityId;
    } else {
      clusters.push({ candidates: [candidate], trackId: candidate.trackId, projectIdentityId: candidate.projectIdentityId });
    }
  }
  return clusters;
}

function clusterRegion(cluster: CandidateCluster): Omit<ImportanceRegion, "id" | "required" | "role"> {
  const ordered = [...cluster.candidates].sort((a, b) => b.evidence - a.evidence);
  const semantic = ordered.filter((candidate) => candidate.source !== "motion");
  // Raw frame difference is context for an observed subject, never a subject.
  if (!semantic.length) throw new Error("motion-only importance cluster");
  const focus = semantic[0]!;
  const sources = [...new Set(ordered.map((candidate) => candidate.source))];
  const semanticEvidence = 1 - semantic.reduce((remaining, candidate) => remaining * (1 - candidate.evidence), 1);
  const motionBoost = ordered.some((candidate) => candidate.source === "motion") ? 0.12 : 0;
  const combinedEvidence = Math.min(1, semanticEvidence + motionBoost);
  const shouldPreserveContext = focus.kind === "person"
    || focus.kind === "action"
    || focus.kind === "screen"
    || focus.kind === "object";
  const contextCandidates = shouldPreserveContext
    ? semantic.filter((candidate) => candidate.source !== "face" && candidate.source !== "head")
    : semantic.filter((candidate) => candidate.source === "face" || candidate.source === "head" || candidate.source === "active-speaker");
  const contentBox = (contextCandidates.length ? contextCandidates : [focus])
    .reduce((box, candidate) => unionBoxes(box, candidate.box), (contextCandidates[0] ?? focus).box);
  const trust = semantic.some((candidate) => candidate.trust === "verified-person")
    ? "verified-person"
    : semantic.some((candidate) => candidate.trust === "video-saliency")
      ? "video-saliency"
      : semantic.some((candidate) => candidate.trust === "unverified-person")
        ? "unverified-person"
      : semantic.some((candidate) => candidate.trust === "object")
        ? "object"
        : "unverified-person";
  return {
    box: focus.box,
    contentBox,
    kind: focus.kind,
    importanceScore: clamp01(combinedEvidence),
    confidence: Math.max(...ordered.map((candidate) => candidate.confidence)),
    detectorConfidence: Math.max(...ordered.map((candidate) => candidate.detectorConfidence ?? 0)),
    sources,
    trackId: cluster.trackId,
    predicted: ordered.every((candidate) => candidate.predicted),
    associationConfidence: Math.min(...ordered.map((candidate) => candidate.associationConfidence ?? 1)),
    identityAmbiguous: ordered.some((candidate) => candidate.identityAmbiguous),
    projectIdentityId: cluster.projectIdentityId,
    trust,
  };
}

function stableUntrackedId(region: Pick<ImportanceRegion, "box" | "kind">): string {
  const x = Math.round((region.box.x + region.box.width / 2) * 20);
  const y = Math.round((region.box.y + region.box.height / 2) * 20);
  return `region:${region.kind}:${x}:${y}`;
}

function matchPreviousId(
  region: Omit<ImportanceRegion, "id" | "required" | "role">,
  previous: ImportanceRegion[],
): string {
  if (region.trackId != null) {
    const isCanonicalPerson = region.sources.some((source) =>
      source === "person" || source === "pose" || source === "face" || source === "head" || source === "active-speaker");
    if (isCanonicalPerson) return `canonical-person:${region.trackId}`;
    const namespace = ["person", "pose", "face", "head", "active-speaker", "object"]
      .find((source) => region.sources.includes(source as ImportanceRegionSource)) ?? region.sources[0] ?? "unknown";
    return `track:${namespace}:${region.trackId}`;
  }
  const best = previous
    .map((candidate) => ({ candidate, overlap: overlapFractionOfSmaller(region.box, candidate.box) }))
    .filter(({ candidate, overlap }) => candidate.kind === region.kind && overlap >= 0.35)
    .sort((a, b) => b.overlap - a.overlap)[0]?.candidate;
  return best?.id ?? stableUntrackedId(region);
}

function isTemporalPersonCandidate(region: ImportanceRegion): boolean {
  return region.kind === "person"
    && region.trust === "unverified-person"
    && region.trackId != null
    && !region.predicted
    && !region.identityAmbiguous
    && (region.detectorConfidence ?? 0) >= TEMPORAL_PERSON_MIN_DETECTOR_CONFIDENCE
    && (region.associationConfidence ?? 0) >= TEMPORAL_PERSON_MIN_ASSOCIATION_CONFIDENCE;
}

function observeTemporalPeople(
  ranked: ImportanceRegion[],
  time: number,
  state: TemporalPersonFallbackState,
): Set<string> {
  const qualified = new Set<string>();
  for (const [id, observation] of state.observations) {
    if (time - observation.lastObservedAt > TEMPORAL_PERSON_MAX_HOLD_SEC) state.observations.delete(id);
  }
  for (const region of ranked.filter(isTemporalPersonCandidate)) {
    const prior = state.observations.get(region.id);
    const continuous = prior != null && time - prior.lastObservedAt <= TEMPORAL_PERSON_MAX_GAP_SEC;
    const observation: TemporalPersonObservation = continuous
      ? { count: prior.count + 1, startedAt: prior.startedAt, lastObservedAt: time }
      : { count: 1, startedAt: time, lastObservedAt: time };
    state.observations.set(region.id, observation);
    if (
      observation.count >= TEMPORAL_PERSON_MIN_OBSERVATIONS
      && time - observation.startedAt >= TEMPORAL_PERSON_MIN_SPAN_SEC
    ) qualified.add(region.id);
  }
  for (const region of ranked) {
    if (!region.predicted || region.trust !== "unverified-person") continue;
    const observation = state.observations.get(region.id);
    if (observation && time - observation.lastObservedAt <= TEMPORAL_PERSON_MAX_HOLD_SEC
      && observation.count >= TEMPORAL_PERSON_MIN_OBSERVATIONS
      && time - observation.startedAt >= TEMPORAL_PERSON_MIN_SPAN_SEC) {
      qualified.add(region.id);
    }
  }
  return qualified;
}

function evidenceSummary(ranked: ImportanceRegion[], qualifiedTemporalIds: Set<string>, status: TargetEvidence["status"]): TargetEvidence {
  return {
    status,
    verifiedPersonCount: ranked.filter((region) => region.trust === "verified-person").length,
    unverifiedPersonCount: ranked.filter((region) =>
      (region.trust === "unverified-person" || region.trust === "temporally-qualified-person")
      && region.kind === "person").length,
    temporallyQualifiedPersonCount: qualifiedTemporalIds.size,
  };
}

function rankFrame(
  regions: SalientRegion[],
  time: number,
  previous: ImportanceRegion[],
  compositionScores?: ReadonlyMap<string, number>,
  saliencyState?: SaliencyStabilityState,
  temporalPersonState?: TemporalPersonFallbackState,
): { regions: ImportanceRegion[]; targetEvidence: TargetEvidence } {
  const clusters = clusterCandidates(regions)
    .filter((cluster) => cluster.candidates.some((candidate) => candidate.source !== "motion"))
    .filter((cluster) => !cluster.candidates.some((candidate) => candidate.identityAmbiguous));
  const ranked = clusters
    .map<ImportanceRegion>((cluster) => {
    const region = clusterRegion(cluster);
    const id = matchPreviousId(region, previous);
    const previousRegion = previous.find((candidate) => candidate.id === id);
    const localImportanceScore = previousRegion
      ? clamp01(region.importanceScore * 0.72 + previousRegion.importanceScore * 0.28 + 0.025)
      : region.importanceScore;
    const compositionScore = region.projectIdentityId == null ? undefined : compositionScores?.get(region.projectIdentityId);
    // The project-wide table is a substantial, but not absolute, vote. A
    // new or temporarily more meaningful person/object can therefore win
    // when its current-frame evidence is stronger.
    const importanceScore = compositionScore == null
      ? localImportanceScore
      : clamp01(localImportanceScore * 0.58 + compositionScore * 0.42);
    return { ...region, id, importanceScore, compositionScore, required: false, role: "candidate" as const } satisfies ImportanceRegion;
    }).sort((a, b) => b.importanceScore - a.importanceScore);

  if (!ranked.length) return { regions: ranked, targetEvidence: evidenceSummary(ranked, new Set(), "no-candidate") };
  const saliency = ranked.find((region) => region.trust === "video-saliency" && region.confidence >= 0.6);
  if (saliencyState) {
    saliencyState.consecutive = saliency && saliencyState.previous
      && intersectionOverUnion(saliency.contentBox, saliencyState.previous.contentBox) >= 0.35
      ? saliencyState.consecutive + 1
      : saliency ? 1 : 0;
    saliencyState.previous = saliency ?? null;
  }
  const verifiedPeople = ranked.filter((region) => region.trust === "verified-person");
  const stableSaliency = saliencyState && saliencyState.consecutive >= 3 ? saliency : undefined;
  const qualifiedTemporalIds = temporalPersonState
    ? observeTemporalPeople(ranked, time, temporalPersonState)
    : new Set<string>();
  // Never turn a YOLOX-only pseudo-person into a required camera target. A
  // real person wins; otherwise a temporally stable ViNet region gets the
  // animation fallback, then independent objects retain product-video use.
  const eligible = verifiedPeople.length
    ? verifiedPeople
    : stableSaliency
      ? [stableSaliency]
      : ranked.filter((region) => region.trust === "object");
  if (!eligible.length) {
    const temporalPrimary = ranked.find((region) => qualifiedTemporalIds.has(region.id));
    if (!temporalPrimary) {
      const hasPendingTemporalPerson = ranked.some(isTemporalPersonCandidate);
      return {
        regions: ranked,
        targetEvidence: evidenceSummary(ranked, qualifiedTemporalIds, hasPendingTemporalPerson ? "temporal-pending" : "no-candidate"),
      };
    }
    temporalPrimary.trust = "temporally-qualified-person";
    temporalPrimary.role = "primary";
    temporalPrimary.required = true;
    return {
      regions: ranked,
      targetEvidence: evidenceSummary(ranked, qualifiedTemporalIds, "qualified"),
    };
  }
  const priorPrimary = previous.find((region) => region.role === "primary" && region.trust !== "unverified-person");
  const retainedPrimary = priorPrimary
    ? eligible.find((region) => region.id === priorPrimary.id && region.importanceScore >= eligible[0]!.importanceScore - 0.12)
    : undefined;
  const primary = retainedPrimary ?? eligible[0]!;
  primary.role = "primary";
  primary.required = true;

  // Three similarly strong people form a group/action composition. Picking
  // an arbitrary pair creates a false split and hides the third participant.
  const topThree = eligible.slice(0, 3);
  const humanKinds = new Set<ImportanceRegionKind>(["face", "head", "speaker", "person"]);
  if (
    topThree.length === 3
    && topThree.every((region) => humanKinds.has(region.kind))
    && topThree[2]!.importanceScore >= topThree[1]!.importanceScore * 0.8
  ) {
    primary.kind = "action";
    primary.contentBox = topThree.reduce(
      (box, region) => unionBoxes(box, region.contentBox),
      topThree[0]!.contentBox,
    );
    for (const region of ranked) {
      if (region.id === primary.id) continue;
      region.role = "candidate";
      region.required = false;
    }
    return { regions: ranked, targetEvidence: evidenceSummary(ranked, qualifiedTemporalIds, "qualified") };
  }

  const secondary = eligible.find((region) =>
    region.id !== primary.id
    && region.importanceScore >= 0.5
    && region.importanceScore >= primary.importanceScore * 0.68
    && overlapFractionOfSmaller(region.contentBox, primary.contentBox) < 0.7,
  );
  if (secondary) {
    secondary.role = "secondary";
    secondary.required = true;
  }
  return { regions: ranked, targetEvidence: evidenceSummary(ranked, qualifiedTemporalIds, "qualified") };
}

/** Adds sparse specialised-model signals to the nearest AutoFlip keyframe. */
export function attachImportanceSignals(
  keyframes: KeyFrameSalientInput[],
  signalSamples: ImportanceSignalSample[] | undefined,
): KeyFrameSalientInput[] {
  if (!signalSamples?.length) return keyframes;
  return keyframes.map((keyframe) => {
    const nearest = signalSamples
      .map((sample) => ({ sample, delta: Math.abs(sample.time - keyframe.time) }))
      .filter(({ delta }) => delta <= 0.15)
      .sort((a, b) => a.delta - b.delta)[0]?.sample;
    if (!nearest) return keyframe;
    const added: SalientRegion[] = nearest.regions.map((region) => ({
      box: region.box,
      score: clamp01(region.confidence),
      signalType: EXTERNAL_SIGNAL_TYPE[region.kind],
      isRequired: false,
      trackId: region.trackId,
      predicted: region.predicted,
    }));
    return { ...keyframe, regions: [...keyframe.regions, ...added] };
  });
}

/** Converts raw proposal regions into stable, explicit editing targets. */
export function buildImportanceTimeline(
  keyframes: KeyFrameSalientInput[],
  compositionScores?: ReadonlyMap<string, number>,
): ImportanceRegionSample[] {
  let previous: ImportanceRegion[] = [];
  let previousObservedTime = Number.NEGATIVE_INFINITY;
  const saliencyState: SaliencyStabilityState = { previous: null, consecutive: 0 };
  const temporalPersonState: TemporalPersonFallbackState = { observations: new Map() };
  return keyframes.map((keyframe) => {
    if (keyframe.isShotChange || keyframe.time - previousObservedTime > 0.6) {
      previous = [];
      saliencyState.previous = null;
      saliencyState.consecutive = 0;
      temporalPersonState.observations.clear();
    }
    const ranked = rankFrame(
      keyframe.regions,
      keyframe.time,
      previous,
      compositionScores,
      saliencyState,
      temporalPersonState,
    );
    const regions = ranked.regions;
    // A detector dropout is not evidence that the person disappeared. Keep
    // the last observed identities for matching, while still emitting an
    // empty sample so the layout arbiter can fall back to baseline.
    if (regions.length) {
      previous = regions;
      previousObservedTime = keyframe.time;
    }
    return {
      time: keyframe.time,
      regions,
      cut: keyframe.isShotChange || undefined,
      targetEvidence: ranked.targetEvidence,
    };
  });
}

export const importanceGeometry = {
  intersectionArea,
  overlapFractionOfSmaller,
  unionBoxes,
};
