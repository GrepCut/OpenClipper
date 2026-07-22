import { describe, expect, it } from "vitest";
import { buildWordCuesForTranscription } from "./cues";
import type { Transcription } from "../../../../services/types/transcription.types";

describe("buildWordCuesForTranscription", () => {
  it("uses real word timestamps when available", () => {
    const transcription: Transcription = {
      id: "t1",
      mediaFileId: "m1",
      engine: "parakeet_local",
      segments: [],
      words: [
        { text: "To", startTime: 0.32, endTime: 0.56 },
        { text: "jest", startTime: 0.56, endTime: 0.88 },
      ],
    };

    const cues = buildWordCuesForTranscription(transcription, 10);
    expect(cues).toEqual([
      { text: "To", start: 0.32, end: 0.56 },
      { text: "jest", start: 0.56, end: 0.88 },
    ]);
  });

  it("falls back to segment interpolation for API transcriptions", () => {
    const transcription: Transcription = {
      id: "t2",
      mediaFileId: "m2",
      engine: "api",
      segments: [
        { id: "s1", startTime: 0, endTime: 2, text: "hello world" },
      ],
    };

    const cues = buildWordCuesForTranscription(transcription, 2);
    expect(cues).toHaveLength(2);
    expect(cues[0]?.text).toBe("hello");
    expect(cues[1]?.text).toBe("world");
  });
});
