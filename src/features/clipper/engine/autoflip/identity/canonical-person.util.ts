import type { CanonicalFusionResult } from "../../types/autoflip.types";
import type {
  AutoFlipFaceDetection,
  CanonicalIdentityTelemetry,
  CanonicalPersonTrack,
  NormalizedBox,
  PoseSubject,
  SubjectDetection,
  SubjectDetectionSample,
} from "../../../shared/smart-crop.util";

// Preserve several missed 5 FPS observations so temporal qualification and the
// native prediction hold can reattach to the same rider.
const MAX_DROPOUT_SEC = 0.9;
const EPSILON = 1e-9;

interface TrackState extends CanonicalPersonTrack {
  personSourceId?: number;
  faceSourceId?: number;
  poseSourceId?: number;
  previousCenter?: { x: number; y: number; time: number };
  dropoutStartedAt?: number;
}

interface Evidence<T> {
  value: T;
  box: NormalizedBox;
  sourceId?: number;
  predicted: boolean;
  confidence: number;
}

function center(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function area(box: NormalizedBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function iou(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(EPSILON, area(a) + area(b) - intersection);
}

function containsCenter(container: NormalizedBox, child: NormalizedBox): boolean {
  const point = center(child);
  return point.x >= container.x && point.x <= container.x + container.width
    && point.y >= container.y && point.y <= container.y + container.height;
}

function trackBox(track: TrackState): NormalizedBox | undefined {
  return track.personBox ?? track.poseBox ?? track.faceBox;
}

function predictedCenter(track: TrackState, time: number): { x: number; y: number } {
  const box = trackBox(track);
  const current = box ? center(box) : { x: 0.5, y: 0.5 };
  const dt = Math.max(0, Math.min(MAX_DROPOUT_SEC, time - track.lastObservedTime));
  return { x: current.x + track.velocity.x * dt, y: current.y + track.velocity.y * dt };
}

function associationScore(
  track: TrackState,
  evidence: Evidence<unknown>,
  kind: "person" | "face" | "pose",
  time: number,
): number {
  const box = trackBox(track);
  if (!box || time - track.lastObservedTime > MAX_DROPOUT_SEC + EPSILON) return Number.NEGATIVE_INFINITY;
  const priorId = kind === "person" ? track.personSourceId : kind === "face" ? track.faceSourceId : track.poseSourceId;
  const point = center(evidence.box);
  const expected = predictedCenter(track, time);
  const distance = Math.hypot(point.x - expected.x, point.y - expected.y);
  const overlap = iou(box, evidence.box);
  const containment = kind === "face"
    ? Number(containsCenter(track.personBox ?? box, evidence.box))
    : Number(containsCenter(evidence.box, track.faceBox ?? box) || containsCenter(box, evidence.box));
  const continuity = evidence.sourceId != null && evidence.sourceId === priorId ? 2.5 : 0;
  let score = continuity + overlap * 1.6 + containment * 0.9 + Math.max(0, 0.65 - distance) * 1.4;
  const geometryValid = continuity > 0 || overlap >= 0.08 || containment > 0 || distance <= 0.28;
  return geometryValid ? score : Number.NEGATIVE_INFINITY;
}

/**
 * Exact global maximum assignment.
 *
 * The native tracker can emit many face candidates for a single frame.  The
 * previous exhaustive search grew as P(tracks, evidence), which blocked the
 * browser thread during AutoFlip construction.  The Hungarian algorithm keeps
 * the same global optimum in polynomial time.  One zero-value dummy column per
 * evidence item represents the valid "leave unmatched" outcome.
 */
function assignGlobally<T>(
  evidence: Evidence<T>[],
  tracks: TrackState[],
  kind: "person" | "face" | "pose",
  time: number,
): Map<number, { track: TrackState; confidence: number; ambiguous: boolean }> {
  if (evidence.length === 0 || tracks.length === 0) return new Map();

  const scores = evidence.map((item) => tracks.map((track) =>
    associationScore(track, item, kind, time)));
  const eligible = scores.map((row) => row.map((score) => Number.isFinite(score) && score >= 0.45));
  const best = maximumWeightAssignment(scores, eligible, tracks.length);
  const result = new Map<number, { track: TrackState; confidence: number; ambiguous: boolean }>();
  for (const [evidenceIndex, trackIndex] of best.entries()) {
    if (trackIndex == null || !eligible[evidenceIndex]![trackIndex]) continue;
    const row = scores[evidenceIndex]!;
    const selected = row[trackIndex]!;
    const runnerUp = Math.max(0, ...row.filter((score, index) => index !== trackIndex && Number.isFinite(score)));
    const confidence = Math.max(0, Math.min(1, 0.45 + selected / 5));
    result.set(evidenceIndex, { track: tracks[trackIndex]!, confidence, ambiguous: selected - runnerUp < 0.25 });
  }
  return result;
}

/** Returns the selected real-track column for every evidence row, or -1. */
function maximumWeightAssignment(
  scores: number[][],
  eligible: boolean[][],
  trackCount: number,
): number[] {
  const rowCount = scores.length;
  // The extra dummy columns make an unmatched observation cost zero and keep
  // the rectangular Hungarian matrix wide enough for every row.
  const columnCount = trackCount + rowCount;
  const u = new Array<number>(rowCount + 1).fill(0);
  const v = new Array<number>(columnCount + 1).fill(0);
  const p = new Array<number>(columnCount + 1).fill(0);
  const way = new Array<number>(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row++) {
    p[0] = row;
    let column = 0;
    const minValue = new Array<number>(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(columnCount + 1).fill(false);
    do {
      used[column] = true;
      const currentRow = p[column]!;
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let candidateColumn = 1; candidateColumn <= columnCount; candidateColumn++) {
        if (used[candidateColumn]) continue;
        const trackIndex = candidateColumn - 1;
        const weight = trackIndex < trackCount && eligible[currentRow - 1]![trackIndex]
          ? scores[currentRow - 1]![trackIndex]!
          : 0;
        // Hungarian solves a minimum-cost assignment; negate the score to
        // maximize it. Stable iteration order gives deterministic tie breaks.
        const reducedCost = -weight - u[currentRow]! - v[candidateColumn]!;
        if (reducedCost < minValue[candidateColumn]!) {
          minValue[candidateColumn] = reducedCost;
          way[candidateColumn] = column;
        }
        if (minValue[candidateColumn]! < delta) {
          delta = minValue[candidateColumn]!;
          nextColumn = candidateColumn;
        }
      }
      for (let index = 0; index <= columnCount; index++) {
        if (used[index]) {
          u[p[index]!] += delta;
          v[index] -= delta;
        } else {
          minValue[index] -= delta;
        }
      }
      column = nextColumn;
    } while (p[column] !== 0);

    do {
      const previousColumn = way[column]!;
      p[column] = p[previousColumn]!;
      column = previousColumn;
    } while (column !== 0);
  }

  const assignment = new Array<number>(rowCount).fill(-1);
  for (let column = 1; column <= trackCount; column++) {
    const row = p[column]!;
    if (row > 0) assignment[row - 1] = column - 1;
  }
  return assignment;
}

function snapshot(track: TrackState, time: number): CanonicalPersonTrack {
  return {
    canonicalId: track.canonicalId,
    personBox: track.personBox,
    faceBox: track.faceBox,
    poseBox: track.poseBox,
    sources: [...track.sources],
    confidence: track.confidence,
    associationConfidence: track.associationConfidence,
    velocity: { ...track.velocity },
    lastObservedTime: track.lastObservedTime,
    state: time - track.lastObservedTime > EPSILON ? "predicted" : track.state,
    identityAmbiguous: track.identityAmbiguous,
  };
}

function observedPersonEvidence(sample: SubjectDetectionSample): Evidence<SubjectDetection>[] {
  return sample.detections
    .filter((item) => item.label.toLowerCase() === "person")
    .map((value) => ({
      value,
      box: value.box,
      sourceId: value.trackId,
      predicted: Boolean(value.predicted),
      confidence: value.score,
    }));
}

/**
 * Fuses independent native tracker namespaces into scene-local person IDs.
 * Only an observed primary person can create a track. Face, pose, prediction
 * and ASD evidence may update an existing track but never create one.
 */
export function buildCanonicalPersonTracks(samples: SubjectDetectionSample[]): CanonicalFusionResult {
  const telemetry: CanonicalIdentityTelemetry = {
    births: 0,
    deaths: 0,
    switches: 0,
    ambiguousSamples: 0,
    sampleCount: samples.length,
    dropoutDurationsSec: [],
    successfulReacquisitions: 0,
    associationConfidences: [],
  };
  let tracks: TrackState[] = [];
  let nextId = 1;
  const sourceOwners = {
    person: new Map<number, number>(),
    face: new Map<number, number>(),
    pose: new Map<number, number>(),
  };
  const recordSourceOwner = (kind: keyof typeof sourceOwners, sourceId: number | undefined, canonicalId: number) => {
    if (sourceId == null) return;
    const previous = sourceOwners[kind].get(sourceId);
    if (previous != null && previous !== canonicalId) telemetry.switches++;
    sourceOwners[kind].set(sourceId, canonicalId);
  };
  const output = [...samples].sort((a, b) => a.time - b.time).map((sample) => {
    if (sample.sceneCut) {
      telemetry.deaths += tracks.length;
      tracks = [];
      nextId = 1;
      sourceOwners.person.clear();
      sourceOwners.face.clear();
      sourceOwners.pose.clear();
    }
    const expired = tracks.filter((track) => sample.time - track.lastObservedTime > MAX_DROPOUT_SEC + EPSILON);
    telemetry.deaths += expired.length;
    tracks = tracks.filter((track) => sample.time - track.lastObservedTime <= MAX_DROPOUT_SEC + EPSILON);
    for (const track of tracks) track.identityAmbiguous = false;

    const people = observedPersonEvidence(sample);
    const primary = people.filter((item) => !item.predicted);
    const personAssignments = assignGlobally(primary, tracks, "person", sample.time);
    const assignedPeople = new Map<SubjectDetection, { track: TrackState; confidence: number; ambiguous: boolean }>();
    for (const [index, assignment] of personAssignments) assignedPeople.set(primary[index]!.value, assignment);
    for (const item of primary) {
      if (assignedPeople.has(item.value)) continue;
      const point = center(item.box);
      const track: TrackState = {
        canonicalId: nextId++,
        personBox: item.box,
        sources: ["person"],
        confidence: item.confidence,
        associationConfidence: 1,
        velocity: { x: 0, y: 0 },
        lastObservedTime: sample.time,
        state: "observed",
        identityAmbiguous: false,
        personSourceId: item.sourceId,
        previousCenter: { ...point, time: sample.time },
      };
      tracks.push(track);
      assignedPeople.set(item.value, { track, confidence: 1, ambiguous: false });
      telemetry.births++;
    }

    const faces: Evidence<AutoFlipFaceDetection>[] = (sample.autoflipFaces ?? []).map((value) => ({
      value, box: value.box, sourceId: value.trackId, predicted: Boolean(value.predicted), confidence: 1,
    }));
    const poses: Evidence<PoseSubject>[] = (sample.poseSubjects ?? []).map((value) => ({
      value, box: value.box, sourceId: value.trackId, predicted: Boolean(value.predicted), confidence: value.score,
    }));
    const faceAssignments = assignGlobally(faces, tracks, "face", sample.time);
    for (const [index, item] of faces.entries()) {
      if (item.predicted || faceAssignments.has(index)) continue;
      const point = center(item.box);
      const track: TrackState = {
        canonicalId: nextId++, faceBox: item.box, sources: ["face"], confidence: item.confidence,
        associationConfidence: 1, velocity: { x: 0, y: 0 }, lastObservedTime: sample.time,
        state: "observed", identityAmbiguous: false, faceSourceId: item.sourceId,
        previousCenter: { ...point, time: sample.time },
      };
      tracks.push(track);
      faceAssignments.set(index, { track, confidence: 1, ambiguous: false });
      telemetry.births++;
    }
    const poseAssignments = assignGlobally(poses, tracks, "pose", sample.time);
    for (const [index, item] of poses.entries()) {
      if (item.predicted || poseAssignments.has(index)) continue;
      const point = center(item.box);
      const track: TrackState = {
        canonicalId: nextId++, poseBox: item.box, sources: ["pose"], confidence: item.confidence,
        associationConfidence: 1, velocity: { x: 0, y: 0 }, lastObservedTime: sample.time,
        state: "observed", identityAmbiguous: false, poseSourceId: item.sourceId,
        previousCenter: { ...point, time: sample.time },
      };
      tracks.push(track);
      poseAssignments.set(index, { track, confidence: 1, ambiguous: false });
      telemetry.births++;
    }
    const secondaryPeople = people.filter((item) => item.predicted);
    const secondaryAssignments = assignGlobally(secondaryPeople, tracks, "person", sample.time);
    for (const [index, assignment] of secondaryAssignments) assignedPeople.set(secondaryPeople[index]!.value, assignment);

    const touch = (track: TrackState, box: NormalizedBox, confidence: number, observed: boolean) => {
      if (!observed) return;
      const point = center(box);
      if (track.dropoutStartedAt != null) {
        telemetry.dropoutDurationsSec.push(sample.time - track.dropoutStartedAt);
        telemetry.successfulReacquisitions++;
        track.dropoutStartedAt = undefined;
      }
      if (track.previousCenter && sample.time > track.previousCenter.time + EPSILON) {
        const dt = sample.time - track.previousCenter.time;
        track.velocity = { x: (point.x - track.previousCenter.x) / dt, y: (point.y - track.previousCenter.y) / dt };
      }
      track.previousCenter = { ...point, time: sample.time };
      track.lastObservedTime = sample.time;
      track.confidence = Math.max(track.confidence * 0.7, confidence);
    };

    const mappedDetections = sample.detections.map((detection) => {
      const assignment = assignedPeople.get(detection);
      if (!assignment) return detection;
      const item = people.find((candidate) => candidate.value === detection)!;
      const { track } = assignment;
      const observed = !item.predicted;
      if (observed) track.personBox = detection.box;
      if (item.sourceId != null) track.personSourceId = item.sourceId;
      recordSourceOwner("person", item.sourceId, track.canonicalId);
      track.state = item.predicted ? "predicted" : "observed";
      track.sources = [...new Set([...track.sources, "person"] as const)];
      track.associationConfidence = assignment.confidence;
      track.identityAmbiguous ||= assignment.ambiguous;
      touch(track, detection.box, detection.score, observed);
      telemetry.associationConfidences.push(assignment.confidence);
      return {
        ...detection,
        trackId: track.canonicalId,
        canonicalId: track.canonicalId,
        associationConfidence: assignment.confidence,
        identityAmbiguous: assignment.ambiguous,
      };
    });

    const mappedFaces = faces.map((item, index) => {
      const assignment = faceAssignments.get(index);
      if (!assignment) return item.value;
      const { track } = assignment;
      if (!item.predicted) track.faceBox = item.box;
      if (item.sourceId != null) track.faceSourceId = item.sourceId;
      recordSourceOwner("face", item.sourceId, track.canonicalId);
      track.sources = [...new Set([...track.sources, "face"] as const)];
      track.associationConfidence = Math.min(track.associationConfidence, assignment.confidence);
      track.identityAmbiguous ||= assignment.ambiguous;
      touch(track, item.box, item.confidence, !item.predicted);
      telemetry.associationConfidences.push(assignment.confidence);
      return { ...item.value, trackId: track.canonicalId, canonicalId: track.canonicalId, associationConfidence: assignment.confidence, identityAmbiguous: assignment.ambiguous };
    });
    const mappedPoses = poses.map((item, index) => {
      const assignment = poseAssignments.get(index);
      if (!assignment) return item.value;
      const { track } = assignment;
      if (!item.predicted) track.poseBox = item.box;
      if (item.sourceId != null) track.poseSourceId = item.sourceId;
      recordSourceOwner("pose", item.sourceId, track.canonicalId);
      track.sources = [...new Set([...track.sources, "pose"] as const)];
      track.associationConfidence = Math.min(track.associationConfidence, assignment.confidence);
      track.identityAmbiguous ||= assignment.ambiguous;
      touch(track, item.box, item.confidence, !item.predicted);
      telemetry.associationConfidences.push(assignment.confidence);
      return { ...item.value, trackId: track.canonicalId, canonicalId: track.canonicalId, associationConfidence: assignment.confidence, identityAmbiguous: assignment.ambiguous };
    });

    for (const track of tracks) {
      if (sample.time > track.lastObservedTime + EPSILON) track.dropoutStartedAt ??= track.lastObservedTime;
    }
    if (tracks.some((track) => track.identityAmbiguous)) telemetry.ambiguousSamples++;
    return {
      ...sample,
      detections: mappedDetections,
      autoflipFaces: mappedFaces,
      poseSubjects: mappedPoses,
      activeSpeakerScores: sample.activeSpeakerScores?.flatMap((score) => {
        const mapped = mappedFaces.find((face, index) => faces[index]?.sourceId === score.trackId && face.canonicalId != null);
        return mapped?.canonicalId != null ? [{ ...score, trackId: mapped.canonicalId }] : [];
      }),
      canonicalPersons: tracks.map((track) => snapshot(track, sample.time)),
    };
  });
  telemetry.deaths += tracks.length;
  return { samples: output, telemetry };
}
