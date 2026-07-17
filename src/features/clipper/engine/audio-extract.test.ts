import { AudioSample } from "mediabunny";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { convertMock, ensureMp3EncoderMock } = vi.hoisted(() => ({
  convertMock: vi.fn(),
  ensureMp3EncoderMock: vi.fn(),
}));

vi.mock("../lib/convert/mediabunny-convert", () => ({
  convertWithMediabunnyBuffer: convertMock,
}));

vi.mock("../lib/convert/mp3-encoder", () => ({
  ensureMp3Encoder: ensureMp3EncoderMock,
}));

vi.mock("../shared/logger", () => ({
  clipperLog: vi.fn(),
  formatBytes: (bytes: number) => `${bytes} B`,
}));

import { extractClipAudioForTranscription } from "./audio-extract";

describe("extractClipAudioForTranscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMp3EncoderMock.mockResolvedValue(undefined);
  });

  it("returns MP3 bytes and ordered mono 16 kHz PCM from one conversion", async () => {
    convertMock.mockImplementation(async (_file, config, options) => {
      expect(config.audio).toMatchObject({
        codec: "mp3",
        bitrate: 64_000,
        numberOfChannels: 1,
        sampleRate: 16_000,
      });
      expect(config.trim).toEqual({ start: 1.25, end: 4.5 });

      const process = config.audio.process as (
        sample: AudioSample,
      ) => AudioSample;
      for (const values of [
        new Float32Array([0.1, -0.2]),
        new Float32Array([0.3]),
      ]) {
        const sample = new AudioSample({
          data: values,
          format: "f32",
          numberOfChannels: 1,
          sampleRate: 16_000,
          timestamp: 0,
        });
        expect(process(sample)).toBe(sample);
        sample.close();
      }

      options.onProgress?.({ ratio: 0.5, stage: "extracting" });
      return new Uint8Array([0xff, 0xfb, 0x90, 0x64]).buffer;
    });

    const onProgress = vi.fn();
    const result = await extractClipAudioForTranscription(
      new File([new Uint8Array([1])], "source.mp4", { type: "video/mp4" }),
      1.25,
      4.5,
      { onProgress },
    );

    expect(ensureMp3EncoderMock).toHaveBeenCalledOnce();
    expect(convertMock).toHaveBeenCalledOnce();
    expect(result.file.name).toBe("clip-audio.mp3");
    expect(result.file.type).toBe("audio/mpeg");
    expect(result.file.size).toBe(4);
    expect(Array.from(result.pcm16k)).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(-0.2),
      expect.closeTo(0.3),
    ]);
    expect(result.pcm16k).toHaveLength(3);
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it("rejects output that contains no decoded PCM samples", async () => {
    convertMock.mockResolvedValue(new Uint8Array([0xff, 0xfb]).buffer);

    await expect(
      extractClipAudioForTranscription(
        new File([new Uint8Array([1])], "silent.mp4"),
        0,
        1,
      ),
    ).rejects.toThrow("Could not decode audio from this clip");
  });
});
