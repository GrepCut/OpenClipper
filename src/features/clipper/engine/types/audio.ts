export interface PreparedTranscriptionAudio {
  file: File;
  /** Mono PCM captured after Mediabunny's 16 kHz remix/resample transform. */
  pcm16k: Float32Array;
}

export interface RmsEnvelope {
  hopSec: number;
  startSec: number;
  values: Float32Array;
}
