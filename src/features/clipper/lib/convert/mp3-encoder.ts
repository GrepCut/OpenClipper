import { canEncodeAudio } from "mediabunny";

let mp3EncoderReady: Promise<void> | null = null;

export function ensureMp3Encoder(): Promise<void> {
  mp3EncoderReady ??= (async () => {
    if (await canEncodeAudio("mp3")) return;
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
  })();
  return mp3EncoderReady;
}
