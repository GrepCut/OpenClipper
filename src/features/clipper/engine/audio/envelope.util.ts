import type { RmsEnvelope } from "../types/audio.types";

export function computeRmsEnvelope(
  pcm: Float32Array,
  sampleRate: number,
  hopSec = 0.01,
): RmsEnvelope {
  const hopSamples = Math.max(1, Math.round(sampleRate * hopSec));
  const values = new Float32Array(Math.ceil(pcm.length / hopSamples));
  for (let hop = 0; hop < values.length; hop++) {
    const start = hop * hopSamples;
    const end = Math.min(pcm.length, start + hopSamples);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += pcm[i]! * pcm[i]!;
    values[hop] = end > start ? Math.sqrt(sumSquares / (end - start)) : 0;
  }
  return { hopSec: hopSamples / sampleRate, startSec: 0, values };
}

export interface RmsEnvelopeAccumulator {
  hopSamples: number;
  values: number[];
  sumSquares: number;
  sampleCount: number;
}

export function createRmsEnvelopeAccumulator(
  sampleRate: number,
  hopSec = 0.01,
): RmsEnvelopeAccumulator {
  return {
    hopSamples: Math.max(1, Math.round(sampleRate * hopSec)),
    values: [],
    sumSquares: 0,
    sampleCount: 0,
  };
}

export function appendRmsSamples(
  accumulator: RmsEnvelopeAccumulator,
  samples: Float32Array,
): void {
  for (const sample of samples) {
    accumulator.sumSquares += sample * sample;
    accumulator.sampleCount++;
    if (accumulator.sampleCount === accumulator.hopSamples) {
      accumulator.values.push(
        Math.sqrt(accumulator.sumSquares / accumulator.sampleCount),
      );
      accumulator.sumSquares = 0;
      accumulator.sampleCount = 0;
    }
  }
}

export function finishRmsEnvelope(
  accumulator: RmsEnvelopeAccumulator,
  sampleRate: number,
): RmsEnvelope {
  if (accumulator.sampleCount > 0) {
    accumulator.values.push(
      Math.sqrt(accumulator.sumSquares / accumulator.sampleCount),
    );
  }
  return {
    hopSec: accumulator.hopSamples / sampleRate,
    startSec: 0,
    values: Float32Array.from(accumulator.values),
  };
}

export function refineBoundaryToSilence(
  env: RmsEnvelope,
  tSec: number,
  searchRadiusSec: number,
  minSec: number,
  maxSec: number,
): number {
  const lower = Math.min(minSec, maxSec);
  const upper = Math.max(minSec, maxSec);
  const original = Math.max(lower, Math.min(upper, tSec));
  if (!env.values.length || env.hopSec <= 0) return original;

  const searchMin = Math.max(lower, tSec - searchRadiusSec);
  const searchMax = Math.min(upper, tSec + searchRadiusSec);
  const first = Math.max(0, Math.ceil((searchMin - env.startSec) / env.hopSec - 1e-9));
  const last = Math.min(env.values.length - 1, Math.floor((searchMax - env.startSec) / env.hopSec + 1e-9));
  if (first > last) return original;

  let bestTime = original;
  let bestEnergy = Infinity;
  let bestDistance = Infinity;
  for (let index = first; index <= last; index++) {
    const time = env.startSec + index * env.hopSec;
    const energy = env.values[index]!;
    const distance = Math.abs(time - tSec);
    if (energy < bestEnergy || (energy === bestEnergy && distance < bestDistance)) {
      bestEnergy = energy;
      bestDistance = distance;
      bestTime = time;
    }
  }
  const nearestOriginalIndex = Math.max(first, Math.min(last, Math.round((original - env.startSec) / env.hopSec)));
  if (env.values[nearestOriginalIndex] === bestEnergy) return original;
  return Math.max(lower, Math.min(upper, bestTime));
}
