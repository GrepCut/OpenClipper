export interface PreparedTranscriptionAudio {
  /** Ready-to-write mono 16 kHz PCM WAV for the native recognizer. */
  wavBytes: Uint8Array;
  /** Calculated while decoding, avoiding retention of all PCM samples. */
  audioEnvelope: RmsEnvelope;
}

export interface RmsEnvelope {
  hopSec: number;
  startSec: number;
  values: Float32Array;
}
