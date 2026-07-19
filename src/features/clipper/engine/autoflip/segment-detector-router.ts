import type {
  ClipperLayoutMode,
  DetectorHypothesis,
  DetectorHypothesisSample,
  NormalizedBox,
} from "../../shared/smart-crop";

export interface DetectorSegmentFeatures {
  sampleCount: number;
  yoloxPresence: number;
  ssdPresence: number;
  yoloxConfidence: number;
  ssdConfidence: number;
  yoloxFaceSupport: number;
  yoloxPoseSupport: number;
  yoloxPersistence: number;
  ssdPersistence: number;
  agreement: number;
  personExcess: number;
  groupSpread: number;
  ambiguity: number;
  motionPenalty: number;
  saliencySupport: number;
}

export interface DetectorSegmentRouterParams {
  segmentDurationSec: number;
  minimumSamples: number;
  minimumFaceSupport: number;
  minimumPersistence: number;
  minimumPersonExcess: number;
  minimumGroupSpread: number;
  enterScore: number;
  exitScore: number;
  minimumHoldSec: number;
  maxSwitchesPerMinute: number;
  weights: {
    yoloxPresence: number;
    relativeConfidence: number;
    faceSupport: number;
    poseSupport: number;
    relativePersistence: number;
    detectorAgreement: number;
    personExcess: number;
    groupSpread: number;
    ambiguity: number;
    motionPenalty: number;
    saliencySupport: number;
  };
}

export const DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS: DetectorSegmentRouterParams =
  {
    segmentDurationSec: 0.6,
    minimumSamples: 2,
    minimumFaceSupport: 0.05,
    minimumPersistence: 0.45,
    minimumPersonExcess: 0.5,
    minimumGroupSpread: 0.1,
    enterScore: 1.0,
    exitScore: 0.75,
    minimumHoldSec: 0.4,
    maxSwitchesPerMinute: 8,
    weights: {
      yoloxPresence: 0.35,
      relativeConfidence: 0.35,
      faceSupport: 1.4,
      poseSupport: 0.25,
      relativePersistence: 0.65,
      detectorAgreement: 0.35,
      personExcess: 0.4,
      groupSpread: 0.2,
      ambiguity: -0.9,
      motionPenalty: -0.4,
      saliencySupport: 0.25,
    },
  };

export interface DetectorSegmentDecision {
  start: number;
  end: number;
  useDetector: boolean;
  score: number;
  features: DetectorSegmentFeatures;
  reasonCodes: string[];
}

export interface GroupUnionLayout {
  mode: ClipperLayoutMode;
  viewports: NormalizedBox[];
  reasonCode: "group-union-crop" | "group-stable-split";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unionBoxes(boxes: NormalizedBox[]): NormalizedBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function fitAspectViewport(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale: number,
  margin: number,
): NormalizedBox | null {
  const left = Math.max(0, box.x - box.width * margin);
  const top = Math.max(0, box.y - box.height * margin);
  const right = Math.min(1, box.x + box.width * (1 + margin));
  const bottom = Math.min(1, box.y + box.height * (1 + margin));
  const expanded = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  const normalizedAspect = targetAspect / Math.max(1e-9, sourceAspect);
  const nominal =
    normalizedAspect <= 1
      ? { width: normalizedAspect, height: 1 }
      : { width: 1, height: 1 / normalizedAspect };
  const scale = Math.max(
    minimumScale,
    expanded.width / Math.max(1e-9, nominal.width),
    expanded.height / Math.max(1e-9, nominal.height),
  );
  if (scale > 1 + 1e-9) return null;
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const minimumX = Math.max(0, expanded.x + expanded.width - width);
  const maximumX = Math.min(1 - width, expanded.x);
  const minimumY = Math.max(0, expanded.y + expanded.height - height);
  const maximumY = Math.min(1 - height, expanded.y);
  if (minimumX > maximumX + 1e-9 || minimumY > maximumY + 1e-9) return null;
  const centerX = expanded.x + expanded.width / 2;
  const centerY = expanded.y + expanded.height * 0.44;
  return {
    x: Math.max(minimumX, Math.min(maximumX, centerX - width / 2)),
    y: Math.max(minimumY, Math.min(maximumY, centerY - height / 2)),
    width,
    height,
  };
}

/** Minimal group crop; impossible 3+ geometry falls back instead of contain. */
export function buildGroupUnionLayout(
  boxes: NormalizedBox[],
  sourceAspect: number,
  targetAspect: number,
  options: { minimumScale?: number; margin?: number } = {},
): GroupUnionLayout | null {
  if (boxes.length < 2) return null;
  const minimumScale = options.minimumScale ?? 0.55;
  const margin = options.margin ?? 0.08;
  const common = fitAspectViewport(
    unionBoxes(boxes),
    sourceAspect,
    targetAspect,
    minimumScale,
    margin,
  );
  if (common) {
    return {
      mode: "single-crop",
      viewports: [common],
      reasonCode: "group-union-crop",
    };
  }
  if (boxes.length !== 2) return null;
  const panels = [...boxes]
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2))
    .map((box) =>
      fitAspectViewport(
        box,
        sourceAspect,
        targetAspect * 2,
        minimumScale,
        margin,
      ),
    );
  if (!panels.every((panel): panel is NormalizedBox => panel != null))
    return null;
  return { mode: "split", viewports: panels, reasonCode: "group-stable-split" };
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function sourceHypotheses(
  sample: DetectorHypothesisSample,
  source: "ssd" | "yolox",
): DetectorHypothesis[] {
  return sample.hypotheses.filter((hypothesis) => hypothesis.source === source);
}

function confidence(hypothesis: DetectorHypothesis): number {
  return Math.max(
    0,
    ...hypothesis.observations
      .filter((observation) => observation.source === hypothesis.source)
      .map((observation) => observation.confidence),
  );
}

function strongest(
  hypotheses: DetectorHypothesis[],
  value: (hypothesis: DetectorHypothesis) => number,
): number {
  return Math.max(0, ...hypotheses.map(value));
}

export function summarizeDetectorSegment(
  samples: DetectorHypothesisSample[],
): DetectorSegmentFeatures {
  const rows = samples.map((sample) => {
    const yolox = sourceHypotheses(sample, "yolox");
    const ssd = sourceHypotheses(sample, "ssd");
    const all = [...yolox, ...ssd];
    const yoloPeople = yolox[0]?.features.personCount ?? yolox.length;
    const ssdPeople = ssd.length;
    return {
      yoloxPresence: yolox.length ? 1 : 0,
      ssdPresence: ssd.length ? 1 : 0,
      yoloxConfidence: strongest(yolox, confidence),
      ssdConfidence: strongest(ssd, confidence),
      yoloxFaceSupport: strongest(yolox, (item) => item.features.faceSupport),
      yoloxPoseSupport: strongest(yolox, (item) => item.features.poseSupport),
      yoloxPersistence: strongest(yolox, (item) =>
        clamp01(item.features.trackPersistenceSamples / 6),
      ),
      ssdPersistence: strongest(ssd, (item) =>
        clamp01(item.features.trackPersistenceSamples / 6),
      ),
      agreement: strongest(all, (item) => item.features.detectorAgreementIou),
      personExcess: clamp01((yoloPeople - ssdPeople) / 3),
      groupSpread: strongest(yolox, (item) => item.features.groupSpread),
      ambiguity: strongest(yolox, (item) =>
        item.features.identityAmbiguous ? 1 : 0,
      ),
      motionPenalty: strongest(yolox, (item) =>
        clamp01(
          item.features.speed / 1.2 +
            item.features.acceleration / 8 +
            item.features.scaleChangeRate / 8,
        ),
      ),
      saliencySupport: strongest(
        yolox,
        (item) => item.features.saliencyOverlap,
      ),
    };
  });
  return {
    sampleCount: samples.length,
    yoloxPresence: mean(rows.map((row) => row.yoloxPresence)),
    ssdPresence: mean(rows.map((row) => row.ssdPresence)),
    yoloxConfidence: mean(rows.map((row) => row.yoloxConfidence)),
    ssdConfidence: mean(rows.map((row) => row.ssdConfidence)),
    yoloxFaceSupport: mean(rows.map((row) => row.yoloxFaceSupport)),
    yoloxPoseSupport: mean(rows.map((row) => row.yoloxPoseSupport)),
    yoloxPersistence: mean(rows.map((row) => row.yoloxPersistence)),
    ssdPersistence: mean(rows.map((row) => row.ssdPersistence)),
    agreement: mean(rows.map((row) => row.agreement)),
    personExcess: mean(rows.map((row) => row.personExcess)),
    groupSpread: mean(rows.map((row) => row.groupSpread)),
    ambiguity: mean(rows.map((row) => row.ambiguity)),
    motionPenalty: mean(rows.map((row) => row.motionPenalty)),
    saliencySupport: mean(rows.map((row) => row.saliencySupport)),
  };
}

export function scoreDetectorSegment(
  features: DetectorSegmentFeatures,
  params: DetectorSegmentRouterParams,
): number {
  const weights = params.weights;
  return (
    features.yoloxPresence * weights.yoloxPresence +
    (features.yoloxConfidence - features.ssdConfidence) *
      weights.relativeConfidence +
    features.yoloxFaceSupport * weights.faceSupport +
    features.yoloxPoseSupport * weights.poseSupport +
    (features.yoloxPersistence - features.ssdPersistence) *
      weights.relativePersistence +
    features.agreement * weights.detectorAgreement +
    features.personExcess * weights.personExcess +
    features.groupSpread * weights.groupSpread +
    features.ambiguity * weights.ambiguity +
    features.motionPenalty * weights.motionPenalty +
    features.saliencySupport * weights.saliencySupport
  );
}

/**
 * Makes one aspect-independent decision per short scene segment. It is pure,
 * deterministic and consumes only runtime-legal detector telemetry.
 */
export function routeDetectorSegments(
  samples: DetectorHypothesisSample[],
  params: DetectorSegmentRouterParams = DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS,
): DetectorSegmentDecision[] {
  if (!samples.length) return [];
  const ordered = [...samples].sort((a, b) => a.time - b.time);
  const groups: DetectorHypothesisSample[][] = [];
  let group: DetectorHypothesisSample[] = [];
  let startedAt = ordered[0]!.time;
  for (const sample of ordered) {
    if (
      group.length &&
      (sample.sceneCut ||
        sample.time - startedAt >= params.segmentDurationSec - 1e-9)
    ) {
      groups.push(group);
      group = [];
      startedAt = sample.time;
    }
    group.push(sample);
  }
  if (group.length) groups.push(group);

  let useDetector = false;
  let lastSwitchAt = ordered[0]!.time;
  let sceneStartedAt = ordered[0]!.time;
  let switchTimes: number[] = [];
  return groups.map((segment) => {
    const start = segment[0]!.time;
    const end = segment.at(-1)!.time + params.segmentDurationSec;
    if (segment[0]!.sceneCut) {
      useDetector = false;
      lastSwitchAt = start;
      sceneStartedAt = start;
      switchTimes = [];
    }
    const features = summarizeDetectorSegment(segment);
    const score = scoreDetectorSegment(features, params);
    // Pose-only recovery is not sufficient to replace the production person
    // path: it is useful support, but cannot disambiguate action crops such as
    // a rider from their board/background without appearance evidence.
    const supported = features.yoloxFaceSupport >= params.minimumFaceSupport;
    const eligible =
      features.sampleCount >= params.minimumSamples &&
      features.yoloxPersistence >= params.minimumPersistence &&
      features.personExcess >= params.minimumPersonExcess &&
      features.groupSpread >= params.minimumGroupSpread &&
      supported &&
      features.ambiguity < 0.5;
    const threshold = useDetector ? params.exitScore : params.enterScore;
    const requested = eligible && score >= threshold;
    let reason = requested ? "detector-score-pass" : "production-fallback";
    if (requested !== useDetector) {
      const heldFor = start - lastSwitchAt;
      switchTimes = switchTimes.filter((time) => start - time < 60);
      const budget = Math.max(
        1,
        Math.floor(
          (Math.max(0, start - sceneStartedAt) * params.maxSwitchesPerMinute) /
            60 +
            1e-9,
        ),
      );
      if (heldFor < params.minimumHoldSec) reason = "router-minimum-hold";
      else if (switchTimes.length >= budget) reason = "router-switch-budget";
      else {
        useDetector = requested;
        lastSwitchAt = start;
        switchTimes.push(start);
        reason = useDetector ? "router-enter-detector" : "router-exit-detector";
      }
    }
    return {
      start,
      end,
      useDetector,
      score,
      features,
      reasonCodes: [reason],
    };
  });
}
