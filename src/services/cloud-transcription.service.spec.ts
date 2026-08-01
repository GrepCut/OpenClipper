import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_MP3_BYTES_PER_SECOND,
  CLOUD_UPLOAD_TARGET_BYTES,
  planCloudAudioChunks,
} from "./cloud-transcribe-audio.util";
import {
  GROQ_MAX_UPLOAD_BYTES,
  mapCloudWhisperResponseToTranscription,
  mergeCloudChunkTranscriptions,
  transcribeWithCloudProvider,
} from "./cloud-transcription.service";
import {
  DEFAULT_CLIPPER_SETTINGS,
  mergeClipperSettings,
} from "../features/clipper/settings/settings.util";
import { parseStoredClipperSettings } from "../features/clipper/persistence/clipper-persistence-schemas.util";

describe("planCloudAudioChunks", () => {
  it("keeps short clips in a single chunk", () => {
    expect(planCloudAudioChunks(300)).toEqual([{ startSec: 0, endSec: 300 }]);
  });

  it("splits long clips into multiple upload windows", () => {
    const maxChunkDurationSec = Math.floor(
      CLOUD_UPLOAD_TARGET_BYTES / CLOUD_MP3_BYTES_PER_SECOND,
    );
    const chunks = planCloudAudioChunks(6192);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toEqual({ startSec: 0, endSec: maxChunkDurationSec });
    expect(chunks.at(-1)?.endSec).toBe(6192);
    const covered = chunks.reduce((sum, chunk) => sum + (chunk.endSec - chunk.startSec), 0);
    expect(covered).toBe(6192);
  });

  it("targets compressed chunks below the Groq upload cap", () => {
    const maxChunkDurationSec = Math.floor(
      CLOUD_UPLOAD_TARGET_BYTES / CLOUD_MP3_BYTES_PER_SECOND,
    );
    const estimatedBytes = maxChunkDurationSec * CLOUD_MP3_BYTES_PER_SECOND;
    expect(estimatedBytes).toBeLessThanOrEqual(GROQ_MAX_UPLOAD_BYTES);
  });
});

describe("mergeCloudChunkTranscriptions", () => {
  it("offsets and merges chunk word timestamps", () => {
    const first = mapCloudWhisperResponseToTranscription(
      {
        language: "pl",
        words: [{ word: "hello", start: 0.1, end: 0.4 }],
      },
      "media-1",
      "groq",
      0,
    );
    const second = mapCloudWhisperResponseToTranscription(
      {
        words: [{ word: "world", start: 0.2, end: 0.5 }],
      },
      "media-1",
      "groq",
      120,
    );
    const merged = mergeCloudChunkTranscriptions([first, second]);
    expect(merged.words).toEqual([
      { text: "hello", startTime: 0.1, endTime: 0.4 },
      { text: "world", startTime: 120.2, endTime: 120.5 },
    ]);
    expect(merged.language).toBe("pl");
  });
});

describe("transcribeWithCloudProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["groq", "openrouter"] as const)(
    "requests word timestamps with timestamp_granularities[] for %s",
    async (provider) => {
      let capturedBody: FormData | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          capturedBody = init?.body as FormData;
          return new Response(
            JSON.stringify({
              words: [{ word: "hello", start: 0.1, end: 0.4 }],
            }),
            { status: 200 },
          );
        }),
      );

      await transcribeWithCloudProvider(
        provider,
        "test-key",
        new Uint8Array([1, 2, 3]),
        "media-1",
      );

      expect(capturedBody).toBeDefined();
      const fieldNames = [...capturedBody!.entries()].map(([key]) => key);
      expect(fieldNames).toContain("timestamp_granularities[]");
      expect(fieldNames).not.toContain("timestamp_granularities");
      expect(capturedBody!.get("timestamp_granularities[]")).toBe("word");
    },
  );
});

describe("mapCloudWhisperResponseToTranscription", () => {
  it("maps word timestamps into transcription segments and words", () => {
    const transcription = mapCloudWhisperResponseToTranscription(
      {
        language: "pl",
        text: "hello world",
        words: [
          { word: "hello", start: 0.1, end: 0.4 },
          { word: "world", start: 0.5, end: 0.9 },
        ],
      },
      "media-1",
      "groq",
    );

    expect(transcription.mediaFileId).toBe("media-1");
    expect(transcription.engine).toBe("groq");
    expect(transcription.language).toBe("pl");
    expect(transcription.words).toEqual([
      { text: "hello", startTime: 0.1, endTime: 0.4 },
      { text: "world", startTime: 0.5, endTime: 0.9 },
    ]);
    expect(transcription.segments).toHaveLength(2);
    expect(transcription.segments[0]?.text).toBe("hello");
    expect(transcription.segments[1]?.text).toBe("world");
  });

  it("throws when word timestamps are missing", () => {
    expect(() =>
      mapCloudWhisperResponseToTranscription(
        { language: "en", text: "no words" },
        "media-1",
        "openrouter",
      ),
    ).toThrow("no word timestamps");
  });
});

describe("clipper settings cloud engines", () => {
  it("parses groq and openrouter engine values", () => {
    const parsed = parseStoredClipperSettings({
      transcription: { engine: "groq" },
    });
    expect(parsed?.transcription?.engine).toBe("groq");

    const merged = mergeClipperSettings(DEFAULT_CLIPPER_SETTINGS, {
      transcription: { engine: "openrouter" },
    });
    expect(merged.transcription.engine).toBe("openrouter");
  });

  it("parses isolateVocals setting", () => {
    const merged = mergeClipperSettings(DEFAULT_CLIPPER_SETTINGS, {
      transcription: { isolateVocals: "off" },
    });
    expect(merged.transcription.isolateVocals).toBe("off");
    expect(DEFAULT_CLIPPER_SETTINGS.transcription.isolateVocals).toBe("on");
  });

  it("falls back to default engine for unknown values", () => {
    const merged = mergeClipperSettings(DEFAULT_CLIPPER_SETTINGS, {
      transcription: { engine: "unknown-provider" },
    });
    expect(merged.transcription.engine).toBe("parakeet");
  });
});
