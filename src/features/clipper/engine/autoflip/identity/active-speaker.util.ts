import type {
  ActiveSpeakerPolicy,
  ActiveSpeakerSegment,
  ActiveSpeakerTurns,
} from "../../types/autoflip.types";
import type { ActiveSpeakerTelemetry, SubjectDetectionSample } from "../../../shared/smart-crop.util";
import {
  ACTIVE_SPEAKER_MAX_SAMPLE_GAP_SEC,
  ACTIVE_SPEAKER_MIN_TURN_SEC,
  ACTIVE_SPEAKER_PROBABILITY_CLAMP,
  ACTIVE_SPEAKER_SILENT_PERCENTILE,
  ACTIVE_SPEAKER_SWITCH_PENALTY,
} from "../config/config.constants";

export const DEFAULT_ACTIVE_SPEAKER_POLICY: ActiveSpeakerPolicy = {
  maximumSampleGapSec: ACTIVE_SPEAKER_MAX_SAMPLE_GAP_SEC,
  switchPenalty: ACTIVE_SPEAKER_SWITCH_PENALTY,
  minimumTurnSec: ACTIVE_SPEAKER_MIN_TURN_SEC,
  probabilityClamp: ACTIVE_SPEAKER_PROBABILITY_CLAMP,
  silentPercentile: ACTIVE_SPEAKER_SILENT_PERCENTILE,
};

/** Viterbi state for "nobody visible is speaking" (silence, off-screen voice, music). */
const NONE = -1;
/** Sample spacing used when a span has a single scored sample. */
const FALLBACK_SAMPLE_DT_SEC = 0.2;

interface ScoredSample {
  time: number;
  /** Canonical track id → Light-ASD probability. */
  scores: Map<number, number>;
  /** Identity is uncertain: the sample carries no evidence for any state. */
  ambiguous: boolean;
}

interface Run {
  state: number;
  start: number;
  end: number;
  samples: number;
}

const EMPTY_TURNS: ActiveSpeakerTurns = {
  segments: [],
  speakingSecondsByTrack: new Map(),
};

function logit(probability: number, clamp: number): number {
  const p = Math.min(1 - clamp, Math.max(clamp, probability));
  return Math.log(p / (1 - p));
}

function toScoredSample(sample: SubjectDetectionSample): ScoredSample | null {
  const raw = sample.activeSpeakerScores;
  if (!raw || raw.length < 2) return null;
  const scores = new Map<number, number>();
  let ambiguous = false;
  for (const score of raw) {
    // Two native tracks fused into one canonical person: unusable evidence.
    if (scores.has(score.trackId)) ambiguous = true;
    scores.set(score.trackId, score.confidence);
  }
  ambiguous ||= (sample.autoflipFaces ?? []).some((face) =>
    face.trackId != null && scores.has(face.trackId) && face.identityAmbiguous === true);
  return { time: sample.time, scores, ambiguous };
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))]!;
}

/**
 * Each face's own "not speaking" level in this span. ASD models carry a
 * stable per-face bias (glasses, beard, head angle, webcam compression), so a
 * face is compared with its own quiet level, never with an absolute 0.5.
 */
function silentBaselines(span: ScoredSample[], tracks: number[], policy: ActiveSpeakerPolicy): Map<number, number> {
  return new Map(tracks.map((track) => [track, percentile(
    span.flatMap((sample) => !sample.ambiguous && sample.scores.has(track)
      ? [logit(sample.scores.get(track)!, policy.probabilityClamp)]
      : []),
    policy.silentPercentile,
  )]));
}

/**
 * Evidence (per second) that `track` is the one visible speaker. Light-ASD sees
 * the same audio for every face, so values rise and fall together; the margin
 * over the strongest other face cancels that shared component, while
 * `min(…, own)` still requires the face to be above its own quiet level.
 * An unscored face carries no evidence (0).
 */
function speakerEvidence(sample: ScoredSample, track: number, clamp: number, baselines: Map<number, number>): number {
  if (sample.ambiguous) return 0;
  const lift = (id: number) => logit(sample.scores.get(id)!, clamp) - (baselines.get(id) ?? 0);
  const own = sample.scores.has(track) ? lift(track) : 0;
  let strongestOther = Number.NEGATIVE_INFINITY;
  for (const other of sample.scores.keys()) {
    if (other !== track) strongestOther = Math.max(strongestOther, lift(other));
  }
  return Math.min(own - strongestOther, own);
}

function sampleDurations(span: ScoredSample[], maximumGapSec: number): number[] {
  return span.map((sample, index) => {
    if (span.length === 1) return FALLBACK_SAMPLE_DT_SEC;
    const previous = span[index - 1]?.time ?? sample.time;
    const next = span[index + 1]?.time ?? sample.time;
    const halfSpan = index === 0 || index === span.length - 1 ? (next - previous) : (next - previous) / 2;
    return Math.min(maximumGapSec, Math.max(0, halfSpan));
  });
}

/** Globally optimal state path with a constant switch penalty (logit-seconds). */
function viterbi(span: ScoredSample[], tracks: number[], durations: number[], policy: ActiveSpeakerPolicy): number[] {
  const states = [NONE, ...tracks];
  const baselines = silentBaselines(span, tracks, policy);
  const emission = (index: number, state: number) => state === NONE
    ? 0
    : speakerEvidence(span[index]!, state, policy.probabilityClamp, baselines) * durations[index]!;
  let scores = states.map((state) => emission(0, state));
  const backPointers: number[][] = [];
  for (let index = 1; index < span.length; index++) {
    const pointers: number[] = [];
    const next = states.map((state, to) => {
      let best = Number.NEGATIVE_INFINITY;
      let bestFrom = to;
      scores.forEach((score, from) => {
        const candidate = score - (from === to ? 0 : policy.switchPenalty);
        if (candidate > best) {
          best = candidate;
          bestFrom = from;
        }
      });
      pointers.push(bestFrom);
      return best + emission(index, state);
    });
    backPointers.push(pointers);
    scores = next;
  }
  let current = scores.indexOf(Math.max(...scores));
  const path = new Array<number>(span.length);
  for (let index = span.length - 1; index >= 0; index--) {
    path[index] = states[current]!;
    if (index > 0) current = backPointers[index - 1]![current]!;
  }
  return path;
}

function runsOf(span: ScoredSample[], path: number[], durations: number[]): Run[] {
  const runs: Run[] = [];
  path.forEach((state, index) => {
    const time = span[index]!.time;
    const start = index === 0 ? time - durations[index]! / 2 : (span[index - 1]!.time + time) / 2;
    const end = index === span.length - 1 ? time + durations[index]! / 2 : (time + span[index + 1]!.time) / 2;
    const last = runs.at(-1);
    if (last && last.state === state) {
      last.end = end;
      last.samples++;
    } else {
      runs.push({ state, start, end, samples: 1 });
    }
  });
  return runs;
}

function mergeAdjacent(runs: Run[]): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.state === run.state) {
      last.end = run.end;
      last.samples += run.samples;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/**
 * Editorial minimum shot length: a speaker turn shorter than `minimumTurnSec`
 * (a backchannel "mhm", a laugh) is absorbed by the surrounding speaker, and a
 * short silence between two turns of the same person keeps that person.
 */
function enforceMinimumTurns(input: Run[], minimumTurnSec: number): Run[] {
  let runs = mergeAdjacent(input);
  for (;;) {
    let shortest = -1;
    runs.forEach((run, index) => {
      if (run.state === NONE || run.end - run.start >= minimumTurnSec) return;
      if (shortest < 0 || run.end - run.start < runs[shortest]!.end - runs[shortest]!.start) shortest = index;
    });
    if (shortest < 0) break;
    const previous = runs[shortest - 1];
    const next = runs[shortest + 1];
    runs[shortest]!.state = previous && previous.state !== NONE
      ? previous.state
      : next && next.state !== NONE
        ? next.state
        : NONE;
    runs = mergeAdjacent(runs);
  }
  runs = runs.map((run, index) => {
    const previous = runs[index - 1];
    const next = runs[index + 1];
    return run.state === NONE && previous && next && previous.state !== NONE
      && previous.state === next.state && run.end - run.start < minimumTurnSec
      ? { ...run, state: previous.state }
      : run;
  });
  return mergeAdjacent(runs);
}

/**
 * Offline speaker-turn segmentation over Light-ASD probabilities. It never
 * creates geometry: it only states which observed canonical person speaks
 * when, so the ranker can order panels and the layout can cut on a turn.
 */
export function applyActiveSpeakerPolicy(
  samples: SubjectDetectionSample[],
  policy: ActiveSpeakerPolicy = DEFAULT_ACTIVE_SPEAKER_POLICY,
): { samples: SubjectDetectionSample[]; turns: ActiveSpeakerTurns; telemetry: ActiveSpeakerTelemetry } {
  const telemetry: ActiveSpeakerTelemetry = {
    enabled: false,
    evaluatedWindows: 0,
    speakerSwitches: 0,
    ambiguousWindows: 0,
    asdDutyCycle: 0,
  };
  const disabledReason = samples.find((sample) => sample.activeSpeakerDisabledReason)?.activeSpeakerDisabledReason;
  const invalidContract = samples.some((sample) => sample.activeSpeakerScores?.some((score) =>
    !Number.isFinite(score.confidence) || score.confidence < 0 || score.confidence > 1));
  if (disabledReason || invalidContract) {
    telemetry.disabledReason = disabledReason ?? "tensor-contract-mismatch";
    return { samples, turns: EMPTY_TURNS, telemetry };
  }

  // Split scored samples into continuous spans inside one shot.
  const spans: Array<{ samples: ScoredSample[]; newScene: boolean }> = [];
  let current: ScoredSample[] = [];
  let sceneCutPending = true;
  let currentStartsScene = true;
  const ordered = [...samples].sort((a, b) => a.time - b.time);
  const closeSpan = () => {
    if (current.length) spans.push({ samples: current, newScene: currentStartsScene });
    current = [];
  };
  for (const sample of ordered) {
    if (sample.sceneCut) {
      closeSpan();
      sceneCutPending = true;
    }
    const scored = toScoredSample(sample);
    if (!scored) continue;
    telemetry.evaluatedWindows++;
    if (scored.ambiguous) telemetry.ambiguousWindows++;
    const previous = current.at(-1);
    if (previous && scored.time - previous.time > policy.maximumSampleGapSec) closeSpan();
    if (!current.length) {
      currentStartsScene = sceneCutPending;
      sceneCutPending = false;
    }
    current.push(scored);
  }
  closeSpan();

  const segments: ActiveSpeakerSegment[] = [];
  const speakingSecondsByTrack = new Map<number, number>();
  let speakingSamples = 0;
  let lastSpeakerInScene: number | null = null;
  for (const span of spans) {
    if (span.newScene) lastSpeakerInScene = null;
    const tracks = [...new Set(span.samples.flatMap((sample) => [...sample.scores.keys()]))].sort((a, b) => a - b);
    const durations = sampleDurations(span.samples, policy.maximumSampleGapSec);
    const path = viterbi(span.samples, tracks, durations, policy);
    const runs = enforceMinimumTurns(runsOf(span.samples, path, durations), policy.minimumTurnSec);
    for (const run of runs) {
      if (run.state === NONE) continue;
      const turnStart = run.state !== lastSpeakerInScene;
      if (turnStart && lastSpeakerInScene != null) telemetry.speakerSwitches++;
      lastSpeakerInScene = run.state;
      segments.push({ start: run.start, end: run.end, trackId: run.state, turnStart });
      speakingSecondsByTrack.set(run.state, (speakingSecondsByTrack.get(run.state) ?? 0) + run.end - run.start);
      speakingSamples += run.samples;
    }
  }

  telemetry.enabled = telemetry.evaluatedWindows > 0;
  telemetry.asdDutyCycle = samples.length ? speakingSamples / samples.length : 0;
  if (!telemetry.enabled) telemetry.disabledReason = "insufficient-stable-canonical-persons";
  return { samples, turns: { segments, speakingSecondsByTrack }, telemetry };
}
