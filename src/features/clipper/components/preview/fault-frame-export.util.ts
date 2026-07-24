import type { TargetEvidence } from "../../shared/smart-crop.util";

export type TimelineSample = {
  t: number;
  semanticScore: number | null;
  baselineScore: number | null;
  hasTargets: boolean;
  targetCount: number;
  strategy?: string;
  reasonCodes?: string[];
  targetEvidence?: TargetEvidence;
  cut?: boolean;
};

export type ScoredTimelineSample = TimelineSample & {
  semanticScore: number;
  baselineScore: number;
};

export type FlatMarginPeriod = {
  kind: "flat-margin";
  startTime: number;
  endTime: number;
  samples: ScoredTimelineSample[];
};

export type UnscoredPeriod = {
  kind: "no-score";
  startTime: number;
  endTime: number;
  samples: TimelineSample[];
};

export type FaultExportPeriod = FlatMarginPeriod | UnscoredPeriod;

export const FLAT_MARGIN_MIN_DURATION_SEC = 4;
export const FLAT_MARGIN_STEP_TOLERANCE = 0.01;
export const FLAT_MARGIN_RANGE_TOLERANCE = 0.02;
export const FLAT_FRAME_EXPORT_INTERVAL_SEC = 0.5;

export function isScored(sample: TimelineSample): sample is ScoredTimelineSample {
  return sample.hasTargets && sample.semanticScore != null && sample.baselineScore != null;
}

/** Finds stable runs in the actual margin, never bridging missing target evidence or cuts. */
export function findFlatMarginPeriods(samples: TimelineSample[]): FlatMarginPeriod[] {
  if (samples.length < 2) return [];
  const periods: FlatMarginPeriod[] = [];
  let run: ScoredTimelineSample[] = [];

  const addPeriod = () => {
    const periodSamples = run;
    run = [];
    if (periodSamples.length < 2) return;
    const gains = periodSamples.map((sample) => sample.semanticScore - sample.baselineScore);
    const gainRange = Math.max(...gains) - Math.min(...gains);
    const duration = periodSamples.at(-1)!.t - periodSamples[0]!.t;
    if (duration >= FLAT_MARGIN_MIN_DURATION_SEC && gainRange <= FLAT_MARGIN_RANGE_TOLERANCE) {
      periods.push({
        kind: "flat-margin",
        startTime: periodSamples[0]!.t,
        endTime: periodSamples.at(-1)!.t,
        samples: periodSamples,
      });
    }
  };

  for (const sample of samples) {
    if (!isScored(sample)) {
      addPeriod();
      continue;
    }
    const previous = run.at(-1);
    const previousGain = previous ? previous.semanticScore - previous.baselineScore : null;
    const gain = sample.semanticScore - sample.baselineScore;
    if (sample.cut || (previousGain != null && Math.abs(gain - previousGain) > FLAT_MARGIN_STEP_TOLERANCE)) {
      addPeriod();
    }
    run.push(sample);
  }
  addPeriod();
  return periods;
}

/** Finds long spans with no score dynamics (missing targets or unscored samples). */
export function findUnscoredPeriods(samples: TimelineSample[]): UnscoredPeriod[] {
  if (samples.length < 2) return [];
  const periods: UnscoredPeriod[] = [];
  let run: TimelineSample[] = [];

  const addPeriod = () => {
    const periodSamples = run;
    run = [];
    if (periodSamples.length < 2) return;
    const duration = periodSamples.at(-1)!.t - periodSamples[0]!.t;
    if (duration >= FLAT_MARGIN_MIN_DURATION_SEC) {
      periods.push({
        kind: "no-score",
        startTime: periodSamples[0]!.t,
        endTime: periodSamples.at(-1)!.t,
        samples: periodSamples,
      });
    }
  };

  for (const sample of samples) {
    if (isScored(sample)) {
      addPeriod();
      continue;
    }
    if (sample.cut && run.length > 0) {
      addPeriod();
    }
    run.push(sample);
    if (sample.cut) {
      addPeriod();
    }
  }
  addPeriod();
  return periods;
}

export function findFaultExportPeriods(samples: TimelineSample[]): FaultExportPeriod[] {
  return [...findFlatMarginPeriods(samples), ...findUnscoredPeriods(samples)]
    .sort((left, right) => left.startTime - right.startTime);
}

export function nearestTimelineSample<T extends TimelineSample>(samples: T[], timeSec: number): T {
  let best = samples[0]!;
  let bestDistance = Math.abs(best.t - timeSec);
  for (const sample of samples) {
    const distance = Math.abs(sample.t - timeSec);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return { ...best, t: timeSec };
}

export function buildFaultExportSamples(period: FaultExportPeriod): TimelineSample[] {
  const exportSamples: TimelineSample[] = [];
  for (let timeSec = period.startTime; timeSec <= period.endTime + 1e-6; timeSec += FLAT_FRAME_EXPORT_INTERVAL_SEC) {
    exportSamples.push(nearestTimelineSample(period.samples, timeSec));
  }
  return exportSamples;
}
