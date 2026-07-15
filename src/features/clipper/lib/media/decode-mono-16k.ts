const WHISPER_SAMPLE_RATE = 16000;

/** Decode containerised audio to mono Float32Array at 16 kHz for Whisper. */
export async function decodeToMono16k(arrayBuffer: ArrayBuffer): Promise<Float32Array> {
  const AudioContextClass =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const decodingCtx = new AudioContextClass();
  const decoded = await decodingCtx.decodeAudioData(arrayBuffer);
  void decodingCtx.close();

  if (decoded.sampleRate === WHISPER_SAMPLE_RATE && decoded.numberOfChannels === 1) {
    const out = new Float32Array(decoded.length);
    decoded.copyFromChannel(out, 0);
    return out;
  }

  const targetLength = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, targetLength, WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const out = new Float32Array(rendered.length);
  rendered.copyFromChannel(out, 0);
  return out;
}
