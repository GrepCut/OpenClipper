export interface PreparedTranscriptionAudio {
  /** Absolute path to mono 16 kHz PCM WAV for the native recognizer. */
  audioPath: string;
  /** Calculated while decoding, avoiding retention of all PCM samples. */
  audioEnvelope: RmsEnvelope;
}

export interface RmsEnvelope {
  hopSec: number;
  startSec: number;
  values: Float32Array;
}
