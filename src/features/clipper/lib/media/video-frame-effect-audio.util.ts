import {
  AudioSampleSink,
  AudioSampleSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
} from "mediabunny";
import {
  AAC_BITRATE,
  throwIfAborted,
  type AudioTrackMode,
  type InputAudioTrack,
} from "./video-frame-effect.types";

export async function processAudioTrack(
  audioTrack: InputAudioTrack | null,
  audioSource: EncodedAudioPacketSource | AudioSampleSource | null,
  audioMode: AudioTrackMode,
  signal?: AbortSignal,
): Promise<void> {
  if (!audioTrack || !audioSource) return;

  if (audioMode === "copy") {
    const src = audioSource as EncodedAudioPacketSource;
    const packetSink = new EncodedPacketSink(audioTrack);
    const decoderConfig = (await audioTrack.getDecoderConfig()) ?? undefined;
    let first = true;
    let timeOffset = 0;
    for await (const packet of packetSink.packets()) {
      throwIfAborted(signal);
      if (first && packet.timestamp < 0) {
        timeOffset = -packet.timestamp;
      }
      const processed =
        timeOffset > 0 ? packet.clone({ timestamp: packet.timestamp + timeOffset }) : packet;
      await src.add(processed, first && decoderConfig ? { decoderConfig } : undefined);
      first = false;
    }
  } else {
    const src = audioSource as AudioSampleSource;
    const sampleSink = new AudioSampleSink(audioTrack);
    let timeOffset = 0;
    let sampleCount = 0;
    for await (const audioSample of sampleSink.samples()) {
      sampleCount++;
      throwIfAborted(signal);
      if (sampleCount === 1 && audioSample.timestamp < 0) {
        timeOffset = -audioSample.timestamp;
      }
      if (timeOffset > 0) {
        audioSample.setTimestamp(audioSample.timestamp + timeOffset);
      }
      await src.add(audioSample);
      audioSample.close();
    }
  }
  audioSource.close();
}

/** Builds the right audio source/mode pair for a track: AAC packets are copied, anything else is transcoded to AAC. */
export function createAudioSource(
  audioTrack: InputAudioTrack | null,
): { audioSource: EncodedAudioPacketSource | AudioSampleSource | null; audioMode: AudioTrackMode } {
  const audioMode: AudioTrackMode = audioTrack ? (audioTrack.codec === "aac" ? "copy" : "transcode") : null;
  const audioSource =
    audioMode === "copy"
      ? new EncodedAudioPacketSource("aac")
      : audioMode === "transcode"
        ? new AudioSampleSource({ codec: "aac", bitrate: AAC_BITRATE })
        : null;
  return { audioSource, audioMode };
}
