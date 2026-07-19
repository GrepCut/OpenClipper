import type {
  AutoFlipFaceDetection,
  DetectorHypothesis,
  DetectorHypothesisObservation,
  DetectorHypothesisSample,
  DetectorHypothesisSource,
  ImportanceSignalRegion,
  NormalizedBox,
  PoseSubject,
  SubjectDetection,
  SubjectDetectionSample,
} from "../../shared/smart-crop";

const EPSILON = 1e-9;
const MAX_ASSOCIATION_GAP_SEC = 0.8;

interface Candidate {
  source: DetectorHypothesisSource;
  box: NormalizedBox;
  confidence: number;
  trackId?: number;
  predicted: boolean;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
  canonicalId?: number;
  observations: DetectorHypothesisObservation[];
}

interface History {
  id: string;
  source: DetectorHypothesisSource;
  explicitTrackId?: number;
  firstTime: number;
  lastTime: number;
  lastObservedTime: number;
  persistence: number;
  box: NormalizedBox;
  velocityX: number;
  velocityY: number;
}

function area(box: NormalizedBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function center(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function iou(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(EPSILON, area(a) + area(b) - intersection);
}

function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ac = center(a);
  const bc = center(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y);
}

function containsCenter(
  container: NormalizedBox,
  child: NormalizedBox,
): boolean {
  const point = center(child);
  return (
    point.x >= container.x &&
    point.x <= container.x + container.width &&
    point.y >= container.y &&
    point.y <= container.y + container.height
  );
}

function overlapFraction(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return (
    (Math.max(0, right - left) * Math.max(0, bottom - top)) /
    Math.max(EPSILON, area(a))
  );
}

function sourceForDetection(
  detection: SubjectDetection,
  fallback: "ssd" | "yolox",
): "ssd" | "yolox" {
  return detection.detectorSource === "yolox" || detection.recoveryOnly
    ? "yolox"
    : fallback;
}

function observation(
  candidate: Omit<Candidate, "observations">,
): DetectorHypothesisObservation {
  return {
    source: candidate.source,
    box: candidate.box,
    confidence: candidate.confidence,
    trackId: candidate.trackId,
    predicted: candidate.predicted,
  };
}

function personCandidates(sample: SubjectDetectionSample): Candidate[] {
  const candidates: Candidate[] = [];
  const append = (detection: SubjectDetection, fallback: "ssd" | "yolox") => {
    if (detection.label.toLowerCase() !== "person") return;
    const source = sourceForDetection(detection, fallback);
    const value: Omit<Candidate, "observations"> = {
      source,
      box: detection.box,
      confidence: detection.score,
      trackId: detection.trackId,
      predicted: Boolean(detection.predicted),
      associationConfidence: detection.associationConfidence,
      identityAmbiguous: detection.identityAmbiguous,
      canonicalId: detection.canonicalId,
    };
    // A YOLOX recovery accepted into `detections` is often also present in the
    // raw shadow list. Retain the source independently, but not twice.
    const duplicate = candidates.find(
      (candidate) =>
        candidate.source === source && iou(candidate.box, detection.box) >= 0.9,
    );
    if (duplicate) {
      if (value.trackId != null && duplicate.trackId == null)
        duplicate.trackId = value.trackId;
      duplicate.confidence = Math.max(duplicate.confidence, value.confidence);
      duplicate.predicted &&= value.predicted;
      duplicate.canonicalId ??= value.canonicalId;
      return;
    }
    candidates.push({ ...value, observations: [observation(value)] });
  };
  sample.detections.forEach((detection) => append(detection, "ssd"));
  sample.shadowDetections?.forEach((detection) => append(detection, "yolox"));
  return candidates;
}

function supportScore(box: NormalizedBox, support: NormalizedBox): number {
  return Math.max(
    iou(box, support),
    containsCenter(box, support) ? 1 : 0,
    containsCenter(support, box) ? 0.5 : 0,
  );
}

function attachSupport(
  candidates: Candidate[],
  faces: AutoFlipFaceDetection[],
  poses: PoseSubject[],
): void {
  const supportedPeople = (box: NormalizedBox) =>
    (["ssd", "yolox"] as const).flatMap((source) => {
      const match = candidates
        .filter((candidate) => candidate.source === source)
        .map((value) => ({ value, score: supportScore(value.box, box) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.value;
      return match ? [match] : [];
    });
  for (const face of faces) {
    const matches = supportedPeople(face.box);
    const support: Omit<Candidate, "observations"> = {
      source: "face",
      box: face.box,
      confidence: 1,
      trackId: face.trackId,
      predicted: Boolean(face.predicted),
      associationConfidence: face.associationConfidence,
      identityAmbiguous: face.identityAmbiguous,
      canonicalId: face.canonicalId,
    };
    if (matches.length)
      matches.forEach((candidate) =>
        candidate.observations.push(observation(support)),
      );
    else candidates.push({ ...support, observations: [observation(support)] });
  }
  for (const pose of poses) {
    const matches = supportedPeople(pose.box);
    const support: Omit<Candidate, "observations"> = {
      source: "pose",
      box: pose.box,
      confidence: pose.score,
      trackId: pose.trackId,
      predicted: Boolean(pose.predicted),
      associationConfidence: pose.associationConfidence,
      identityAmbiguous: pose.identityAmbiguous,
      canonicalId: pose.canonicalId,
    };
    if (matches.length)
      matches.forEach((candidate) =>
        candidate.observations.push(observation(support)),
      );
    else candidates.push({ ...support, observations: [observation(support)] });
  }
}

function saliencyOverlap(
  box: NormalizedBox,
  signals: ImportanceSignalRegion[],
): number {
  return Math.max(
    0,
    ...signals.map(
      (signal) => overlapFraction(box, signal.box) * signal.confidence,
    ),
  );
}

function groupSpread(candidates: Candidate[]): number {
  const ssd = candidates.filter((candidate) => candidate.source === "ssd");
  const yolox = candidates.filter((candidate) => candidate.source === "yolox");
  const people = yolox.length > ssd.length ? yolox : ssd;
  if (people.length < 2) return 0;
  const left = Math.min(...people.map((candidate) => candidate.box.x));
  const right = Math.max(
    ...people.map((candidate) => candidate.box.x + candidate.box.width),
  );
  return Math.max(0, right - left);
}

function bestCrossDetector(
  candidate: Candidate,
  candidates: Candidate[],
): { iou: number; distance: number; areaRatio: number } {
  if (candidate.source !== "ssd" && candidate.source !== "yolox")
    return { iou: 0, distance: 1, areaRatio: 0 };
  const otherSource = candidate.source === "ssd" ? "yolox" : "ssd";
  const matches = candidates
    .filter((other) => other.source === otherSource)
    .map((other) => ({
      iou: iou(candidate.box, other.box),
      distance: centerDistance(candidate.box, other.box),
      areaRatio:
        Math.min(area(candidate.box), area(other.box)) /
        Math.max(EPSILON, Math.max(area(candidate.box), area(other.box))),
    }));
  return (
    matches.sort((a, b) => b.iou - a.iou || a.distance - b.distance)[0] ?? {
      iou: 0,
      distance: 1,
      areaRatio: 0,
    }
  );
}

function associateHistory(
  candidate: Candidate,
  histories: History[],
  usedHistoryIds: Set<string>,
  time: number,
  nextId: () => string,
): History {
  let history =
    candidate.trackId == null
      ? undefined
      : histories.find(
          (item) =>
            !usedHistoryIds.has(item.id) &&
            item.source === candidate.source &&
            item.explicitTrackId === candidate.trackId,
        );
  history ??= histories
    .filter(
      (item) =>
        !usedHistoryIds.has(item.id) &&
        item.source === candidate.source &&
        item.explicitTrackId == null &&
        time - item.lastTime <= MAX_ASSOCIATION_GAP_SEC,
    )
    .map((item) => ({
      item,
      overlap: iou(item.box, candidate.box),
      distance: centerDistance(item.box, candidate.box),
    }))
    .filter((entry) => entry.overlap >= 0.15 || entry.distance <= 0.18)
    .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance)[0]?.item;
  if (history) return history;
  history = {
    id: nextId(),
    source: candidate.source,
    explicitTrackId: candidate.trackId,
    firstTime: time,
    lastTime: time,
    lastObservedTime: candidate.predicted ? time : time,
    persistence: 0,
    box: candidate.box,
    velocityX: 0,
    velocityY: 0,
  };
  histories.push(history);
  return history;
}

/**
 * Builds a source-preserving, GT-free feature bank for offline/shadow routing.
 * It never mutates the detector samples and is not consulted by production.
 */
export function buildDetectorHypothesisBank(
  samples: SubjectDetectionSample[],
): DetectorHypothesisSample[] {
  let histories: History[] = [];
  let sequence = 0;
  let lastCutTime = samples[0]?.time ?? 0;
  return [...samples]
    .sort((a, b) => a.time - b.time)
    .map((sample) => {
      if (sample.sceneCut) {
        histories = [];
        lastCutTime = sample.time;
      }
      histories = histories.filter(
        (history) => sample.time - history.lastTime <= MAX_ASSOCIATION_GAP_SEC,
      );
      const candidates = personCandidates(sample);
      attachSupport(
        candidates,
        sample.autoflipFaces ?? [],
        sample.poseSubjects ?? [],
      );
      const spread = groupSpread(candidates);
      const personCount = Math.max(
        candidates.filter((candidate) => candidate.source === "ssd").length,
        candidates.filter((candidate) => candidate.source === "yolox").length,
      );
      const usedHistoryIds = new Set<string>();
      const hypotheses: DetectorHypothesis[] = candidates.map((candidate) => {
        const history = associateHistory(
          candidate,
          histories,
          usedHistoryIds,
          sample.time,
          () => `${candidate.source}:${++sequence}`,
        );
        usedHistoryIds.add(history.id);
        const dt = Math.max(0, sample.time - history.lastTime);
        const previousCenter = center(history.box);
        const currentCenter = center(candidate.box);
        const velocityX =
          dt > EPSILON
            ? (currentCenter.x - previousCenter.x) / dt
            : history.velocityX;
        const velocityY =
          dt > EPSILON
            ? (currentCenter.y - previousCenter.y) / dt
            : history.velocityY;
        const acceleration =
          dt > EPSILON
            ? Math.hypot(
                velocityX - history.velocityX,
                velocityY - history.velocityY,
              ) / dt
            : 0;
        const scaleChangeRate =
          dt > EPSILON
            ? Math.abs(
                Math.log(
                  Math.max(EPSILON, area(candidate.box)) /
                    Math.max(EPSILON, area(history.box)),
                ),
              ) / dt
            : 0;
        const agreement = bestCrossDetector(candidate, candidates);
        const faceSupport = Math.max(
          0,
          ...candidate.observations
            .filter((item) => item.source === "face")
            .map((item) => item.confidence),
        );
        const poseSupport = Math.max(
          0,
          ...candidate.observations
            .filter((item) => item.source === "pose")
            .map((item) => item.confidence),
        );
        const activeSpeakerSupport = Math.max(
          0,
          ...(sample.activeSpeakerScores ?? []).flatMap((score) =>
            candidate.observations.some(
              (item) =>
                item.source === "face" && item.trackId === score.trackId,
            )
              ? [score.confidence]
              : [],
          ),
        );
        const canonicalMatch = sample.canonicalPersons
          ?.map((person) => ({
            person,
            score: person.personBox ? iou(person.personBox, candidate.box) : 0,
          }))
          .sort((a, b) => b.score - a.score)[0];
        const canonical =
          sample.canonicalPersons?.find(
            (person) => person.canonicalId === candidate.canonicalId,
          ) ??
          (canonicalMatch && canonicalMatch.score > 0.05
            ? canonicalMatch.person
            : undefined);
        const lastObservedTime = candidate.predicted
          ? history.lastObservedTime
          : sample.time;
        const hypothesis: DetectorHypothesis = {
          id: history.id,
          source: candidate.source,
          canonicalId: candidate.canonicalId ?? canonical?.canonicalId,
          observations: candidate.observations,
          features: {
            detectorAgreementIou: agreement.iou,
            detectorCenterDistance: agreement.distance,
            detectorAreaRatio: agreement.areaRatio,
            trackAgeSec: Math.max(0, sample.time - history.firstTime),
            trackPersistenceSamples: history.persistence + 1,
            timeSinceObservedSec: Math.max(0, sample.time - lastObservedTime),
            faceSupport,
            poseSupport,
            activeSpeakerSupport,
            associationConfidence:
              candidate.associationConfidence ??
              canonical?.associationConfidence ??
              0,
            identityAmbiguous: Boolean(
              candidate.identityAmbiguous || canonical?.identityAmbiguous,
            ),
            velocityX,
            velocityY,
            speed: Math.hypot(velocityX, velocityY),
            acceleration,
            scaleChangeRate,
            saliencyOverlap: saliencyOverlap(
              candidate.box,
              sample.importanceSignals ?? [],
            ),
            personCount,
            groupSpread: spread,
            secondsSinceCut: Math.max(0, sample.time - lastCutTime),
          },
        };
        history.lastTime = sample.time;
        history.lastObservedTime = lastObservedTime;
        history.persistence++;
        history.box = candidate.box;
        history.velocityX = velocityX;
        history.velocityY = velocityY;
        return hypothesis;
      });
      return {
        time: sample.time,
        sceneCut: Boolean(sample.sceneCut),
        hypotheses,
      };
    });
}
