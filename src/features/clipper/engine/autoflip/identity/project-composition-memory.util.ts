import type {
  CompositionEntityKind,
  CompositionMemoryEntity,
  CompositionMemorySummary,
  NormalizedBox,
  SubjectDetectionSample,
} from "../../../shared/smart-crop.util";

const MAX_ENTITIES_PER_KIND = 12;
// Keep a small working set in addition to the persisted top-K summary. This
// makes association cost and memory independent of the duration of a project.
const MAX_ACTIVE_ENTITIES_PER_KIND = MAX_ENTITIES_PER_KIND * 2;
const MAX_DURATION_DELTA_SEC = 0.5;

interface EntityState {
  id: string;
  kind: CompositionEntityKind;
  label?: string;
  observedSeconds: number;
  speakerSeconds: number;
  sceneIds: Set<number>;
  heights: number[];
  saliencyTotal: number;
  observationCount: number;
  continuityHits: number;
  lastSeen: number;
  lastBox?: NormalizedBox;
}

export interface ProjectCompositionMemoryResult {
  samples: SubjectDetectionSample[];
  summary: CompositionMemorySummary;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function intersectionOverUnion(a: NormalizedBox | undefined, b: NormalizedBox | undefined): number {
  if (!a || !b) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > Number.EPSILON ? intersection / union : 0;
}

function entityKey(kind: CompositionEntityKind, scene: number, localId: number | undefined, label?: string): string {
  return `${kind}:${scene}:${label ?? "unknown"}:${localId ?? "untracked"}`;
}

function findEntity(
  states: EntityState[],
  kind: CompositionEntityKind,
  label: string | undefined,
  box: NormalizedBox,
  time: number,
): EntityState | undefined {
  const candidates = states.filter((state) => state.kind === kind && (kind === "person" || state.label === label));
  return candidates
    .filter((state) => time - state.lastSeen <= MAX_DURATION_DELTA_SEC)
    .map((state) => ({ state, overlap: intersectionOverUnion(state.lastBox, box) }))
    .filter(({ overlap }) => overlap >= 0.25)
    .sort((a, b) => b.overlap - a.overlap)[0]?.state;
}

function appendHeight(state: EntityState, height: number): void {
  state.heights.push(clamp01(height));
  if (state.heights.length > 32) state.heights.shift();
}

function updateEntity(
  state: EntityState,
  time: number,
  scene: number,
  box: NormalizedBox,
  confidence: number,
  speaker: boolean,
): void {
  const elapsed = Math.max(0, Math.min(MAX_DURATION_DELTA_SEC, time - state.lastSeen));
  state.observedSeconds += elapsed;
  if (speaker) state.speakerSeconds += elapsed;
  if (elapsed > 0 && intersectionOverUnion(state.lastBox, box) >= 0.25) state.continuityHits++;
  state.lastSeen = time;
  state.lastBox = box;
  state.sceneIds.add(scene);
  state.saliencyTotal += clamp01(confidence);
  state.observationCount++;
  appendHeight(state, box.height);
}

function makeEntity(
  id: string,
  kind: CompositionEntityKind,
  label: string | undefined,
  time: number,
  scene: number,
  box: NormalizedBox,
  confidence: number,
  speaker: boolean,
): EntityState {
  const state: EntityState = {
    id,
    kind,
    label,
    observedSeconds: 0,
    speakerSeconds: 0,
    sceneIds: new Set([scene]),
    heights: [],
    saliencyTotal: 0,
    observationCount: 0,
    continuityHits: 0,
    lastSeen: time,
    lastBox: box,
  };
  updateEntity(state, time, scene, box, confidence, speaker);
  return state;
}

function scoreEntities(states: EntityState[]): CompositionMemoryEntity[] {
  const grouped = new Map<CompositionEntityKind, EntityState[]>();
  for (const state of states) grouped.set(state.kind, [...(grouped.get(state.kind) ?? []), state]);
  return [...grouped.values()].flatMap((items) => {
    const maxObserved = Math.max(1, ...items.map((state) => state.observedSeconds));
    const maxSpeaker = Math.max(1, ...items.map((state) => state.speakerSeconds));
    return items
      .map<CompositionMemoryEntity>((state) => {
        const observed = state.observedSeconds / maxObserved;
        const speaker = state.speakerSeconds / maxSpeaker;
        const medianHeight = median(state.heights);
        const continuity = state.observationCount > 1 ? state.continuityHits / (state.observationCount - 1) : 0;
        const saliency = state.observationCount ? state.saliencyTotal / state.observationCount : 0;
        const semanticPrior = state.kind === "object" && ["car", "truck", "cat", "dog", "bird", "horse"].includes(state.label ?? "") ? 1 : 0.45;
        const importanceScore = state.kind === "person"
          ? clamp01(observed * 0.35 + speaker * 0.30 + medianHeight * 0.20 + continuity * 0.10 + saliency * 0.05)
          : clamp01(observed * 0.30 + medianHeight * 0.25 + saliency * 0.20 + continuity * 0.15 + semanticPrior * 0.10);
        return {
          id: state.id,
          kind: state.kind,
          label: state.label,
          importanceScore,
          observedSeconds: state.observedSeconds,
          speakerSeconds: state.speakerSeconds,
          sceneCount: state.sceneIds.size,
          medianHeight,
          continuity,
          saliency,
        };
      })
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, MAX_ENTITIES_PER_KIND);
  });
}

function retentionScore(state: EntityState): number {
  const averageSaliency = state.observationCount ? state.saliencyTotal / state.observationCount : 0;
  return state.observedSeconds + state.speakerSeconds * 1.5 + averageSaliency * 0.5 + state.continuityHits * 0.05;
}

function trimWorkingSet(states: EntityState[], localOwners: Map<string, string>): void {
  for (const kind of ["person", "object"] satisfies CompositionEntityKind[]) {
    const candidates = states
      .filter((state) => state.kind === kind)
      .sort((left, right) => retentionScore(right) - retentionScore(left));
    while (candidates.length > MAX_ACTIVE_ENTITIES_PER_KIND) {
      const discarded = candidates.shift();
      if (!discarded) break;
      const index = states.indexOf(discarded);
      if (index >= 0) states.splice(index, 1);
      for (const [key, ownerId] of localOwners) {
        if (ownerId === discarded.id) localOwners.delete(key);
      }
    }
  }
}

/**
 * Creates a fixed-size, project-wide evidence summary after all samples are
 * available. It intentionally never invents an identity when appearance and
 * short-term geometry cannot support an association.
 */
export function buildProjectCompositionMemory(samples: SubjectDetectionSample[]): ProjectCompositionMemoryResult {
  const states: EntityState[] = [];
  const localOwners = new Map<string, string>();
  let nextId = 1;
  let scene = 0;
  let previousTime = Number.NEGATIVE_INFINITY;
  const output = [...samples].sort((a, b) => a.time - b.time).map((sample) => {
    if (sample.sceneCut) {
      scene++;
      // Track IDs are scene-local. Dropping old aliases prevents a long video
      // from accumulating one map entry per historical detector track.
      localOwners.clear();
    }
    const speakerTrackIds = new Set(
      (sample.importanceSignals ?? [])
        .filter((signal) => signal.kind === "active-speaker" && signal.confidence >= 0.7)
        .flatMap((signal) => signal.trackId == null ? [] : [signal.trackId]),
    );
    const personOwners = new Map<number, string>();
    const resolve = (
      kind: CompositionEntityKind,
      label: string | undefined,
      localId: number | undefined,
      box: NormalizedBox,
      confidence: number,
      speaker = false,
    ): string => {
      const localKey = entityKey(kind, scene, localId, label);
      const owned = localOwners.get(localKey);
      const existing = owned ? states.find((state) => state.id === owned) : undefined;
      const entity = existing ?? findEntity(states, kind, label, box, sample.time)
        ?? makeEntity(`project-${kind}-${nextId++}`, kind, label, sample.time, scene, box, confidence, speaker);
      if (!states.includes(entity)) states.push(entity);
      localOwners.set(localKey, entity.id);
      if (entity.lastSeen !== sample.time || entity.observationCount === 0) {
        updateEntity(entity, sample.time, scene, box, confidence, speaker);
      } else if (speaker) {
        // The observation is already counted; add only its speaker evidence.
        entity.speakerSeconds += Math.max(0, Math.min(MAX_DURATION_DELTA_SEC, sample.time - previousTime));
      }
      return entity.id;
    };
    const detections = sample.detections.map((detection) => {
      if (detection.predicted) return detection;
      const kind: CompositionEntityKind = detection.label.toLowerCase() === "person" ? "person" : "object";
      const identity = resolve(kind, kind === "object" ? detection.label.toLowerCase() : undefined, detection.canonicalId ?? detection.trackId, detection.box, detection.score, speakerTrackIds.has(detection.canonicalId ?? detection.trackId ?? -1));
      if (kind === "person" && detection.canonicalId != null) personOwners.set(detection.canonicalId, identity);
      return { ...detection, projectIdentityId: identity };
    });
    const faces = sample.autoflipFaces?.map((face) => ({
      ...face,
      projectIdentityId: face.canonicalId != null ? personOwners.get(face.canonicalId) : undefined,
    }));
    const poses = sample.poseSubjects?.map((pose) => ({
      ...pose,
      projectIdentityId: pose.canonicalId != null ? personOwners.get(pose.canonicalId) : undefined,
    }));
    trimWorkingSet(states, localOwners);
    previousTime = sample.time;
    return { ...sample, detections, autoflipFaces: faces, poseSubjects: poses };
  });
  const entities = scoreEntities(states);
  // This is deliberately a table instead of one globally hard-coded hero.
  // Different scenes can legitimately foreground a person, a product, an
  // animal or a vehicle; the per-frame ranker combines this durable order
  // with current detector evidence before choosing a crop target.
  const rankedEntityIds = [...entities]
    .sort((left, right) =>
      right.importanceScore - left.importanceScore
      || right.observedSeconds - left.observedSeconds
      || right.continuity - left.continuity)
    .map((entity) => entity.id);
  return {
    samples: output,
    summary: { version: 2, entities, rankedEntityIds, maxEntitiesPerKind: MAX_ENTITIES_PER_KIND },
  };
}

export function compositionScoreByIdentity(summary: CompositionMemorySummary): ReadonlyMap<string, number> {
  return new Map(summary.entities.map((entity) => [entity.id, entity.importanceScore]));
}
