import type { RmsEnvelope } from "../types/audio";

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
