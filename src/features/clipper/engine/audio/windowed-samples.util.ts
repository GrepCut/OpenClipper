export function trimAudioSampleToWindow(
  sampleStartSec: number,
  sampleDurationSec: number,
  windowStartSec: number,
  windowEndSec: number,
): { offsetSec: number; durationSec: number; outputTimestampSec: number } | null {
  const overlapStart = Math.max(sampleStartSec, windowStartSec);
  const overlapEnd = Math.min(sampleStartSec + sampleDurationSec, windowEndSec);
  if (overlapEnd <= overlapStart) return null;
  return {
    offsetSec: overlapStart - sampleStartSec,
    durationSec: overlapEnd - overlapStart,
    outputTimestampSec: overlapStart - windowStartSec,
  };
}

export function applySeamFades(
  pcm: Float32Array,
  channels: number,
  sampleRate: number,
  fadeInSec: number,
  fadeOutSec: number,
): void {
  if (channels <= 0 || sampleRate <= 0) return;
  const frames = Math.floor(pcm.length / channels);
  const fadeInFrames = Math.min(frames, Math.max(0, Math.round(fadeInSec * sampleRate)));
  const fadeOutFrames = Math.min(frames, Math.max(0, Math.round(fadeOutSec * sampleRate)));
  for (let frame = 0; frame < fadeInFrames; frame++) {
    const gain = fadeInFrames <= 1 ? 0 : frame / (fadeInFrames - 1);
    for (let channel = 0; channel < channels; channel++) pcm[frame * channels + channel]! *= gain;
  }
  for (let offset = 0; offset < fadeOutFrames; offset++) {
    const frame = frames - fadeOutFrames + offset;
    const gain = fadeOutFrames <= 1 ? 0 : 1 - offset / (fadeOutFrames - 1);
    for (let channel = 0; channel < channels; channel++) pcm[frame * channels + channel]! *= gain;
  }
}
