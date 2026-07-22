import type { ActiveSpeakerPolicy } from "../../types/autoflip.types";
import type { ActiveSpeakerTelemetry, SubjectDetectionSample } from "../../../shared/smart-crop.util";

export const DEFAULT_ACTIVE_SPEAKER_POLICY: ActiveSpeakerPolicy = {
  threshold: 0.6,
  runnerUpMargin: 0.1,
  stableMultiFaceSamples: 5,
  maximumSampleGapSec: 0.6,
  minimumMultiFaceDurationSec: 1,
  minimumHoldSec: 0.8,
};

/**
 * Converts LR-ASD scores into salience evidence. The function never creates
 * geometry: scores are accepted only for an observed face with the same
 * ByteTrack id and only after a stable multi-face span.
 */
export function attachActiveSpeakerSignals(
  samples: SubjectDetectionSample[],
  policy: ActiveSpeakerPolicy = DEFAULT_ACTIVE_SPEAKER_POLICY,
): SubjectDetectionSample[] {
  return applyActiveSpeakerPolicy(samples, policy).samples;
}

export function applyActiveSpeakerPolicy(
  samples: SubjectDetectionSample[],
  policy: ActiveSpeakerPolicy = DEFAULT_ACTIVE_SPEAKER_POLICY,
): { samples: SubjectDetectionSample[]; telemetry: ActiveSpeakerTelemetry } {
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
    return { samples, telemetry };
  }
  let stableSamples = 0;
  let previousTime: number | null = null;
  let multiFaceStartedAt: number | null = null;
  let activeTrackId: number | null = null;
  let activeSince = Number.NEGATIVE_INFINITY;
  let signalSamples = 0;
  const output = samples.map((sample) => {
    const observed = (sample.autoflipFaces ?? []).filter((face) => face.trackId != null && !face.predicted);
    if (sample.sceneCut || previousTime == null || sample.time - previousTime > policy.maximumSampleGapSec) {
      stableSamples = observed.length >= 2 ? 1 : 0;
      multiFaceStartedAt = observed.length >= 2 ? sample.time : null;
      activeTrackId = null;
      activeSince = Number.NEGATIVE_INFINITY;
    } else {
      stableSamples = observed.length >= 2 ? stableSamples + 1 : 0;
      if (observed.length >= 2) multiFaceStartedAt ??= sample.time;
      else multiFaceStartedAt = null;
    }
    previousTime = sample.time;
    const stableDuration = multiFaceStartedAt == null ? 0 : sample.time - multiFaceStartedAt;
    if (stableSamples < policy.stableMultiFaceSamples
      || stableDuration + 1e-9 < policy.minimumMultiFaceDurationSec
      || !sample.activeSpeakerScores?.length) return sample;
    telemetry.evaluatedWindows++;

    const faces = new Map(observed.map((face) => [face.trackId!, face]));
    const ranked = sample.activeSpeakerScores
      .filter((score) => faces.has(score.trackId) && Number.isFinite(score.confidence))
      .sort((a, b) => b.confidence - a.confidence);
    const winner = ranked[0];
    const runnerUp = ranked[1]?.confidence ?? 0;
    if (!winner || winner.confidence < policy.threshold || winner.confidence - runnerUp < policy.runnerUpMargin) {
      telemetry.ambiguousWindows++;
      return sample;
    }
    if (activeTrackId != null && winner.trackId !== activeTrackId && sample.time - activeSince < policy.minimumHoldSec) {
      return sample;
    }
    if (winner.trackId !== activeTrackId) {
      if (activeTrackId != null) telemetry.speakerSwitches++;
      activeTrackId = winner.trackId;
      activeSince = sample.time;
    }
    const face = faces.get(winner.trackId)!;
    signalSamples++;
    return {
      ...sample,
      importanceSignals: [
        ...(sample.importanceSignals ?? []),
        {
          box: face.box,
          kind: "active-speaker" as const,
          confidence: winner.confidence,
          trackId: winner.trackId,
          predicted: false,
        },
      ],
    };
  });
  telemetry.enabled = telemetry.evaluatedWindows > 0;
  telemetry.asdDutyCycle = samples.length ? signalSamples / samples.length : 0;
  if (!telemetry.enabled) telemetry.disabledReason = "insufficient-stable-canonical-persons";
  return { samples: output, telemetry };
}
