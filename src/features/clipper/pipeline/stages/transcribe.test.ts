import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipperSession } from "../session";
import type { PipelineReporter } from "../reporter";

const { extractAudioMock, getTranscriptionMock, transcribeMock } = vi.hoisted(
  () => ({
    extractAudioMock: vi.fn(),
    getTranscriptionMock: vi.fn(),
    transcribeMock: vi.fn(),
  }),
);

vi.mock("../../engine/audio-extract", () => ({
  extractClipAudioForTranscription: extractAudioMock,
}));

vi.mock("../../../../services/transcription.service", () => ({
  transcriptionService: {
    getTranscription: getTranscriptionMock,
    transcribe: transcribeMock,
  },
}));

import { runTranscribeStage } from "./transcribe";

function createSession(): ClipperSession {
  return {
    sourceFile: new File([new Uint8Array([1])], "source.mp4"),
    rangeTrimmedFile: null,
    trimmedFile: null,
    mediaFileId: "media-1",
    audioEnvelope: null,
  } as ClipperSession;
}

function createReporter(): PipelineReporter {
  return {
    stage: vi.fn(),
    stageProgress: vi.fn(),
    faceProgress: vi.fn(),
    subjectProgress: vi.fn(),
    eta: vi.fn(),
    faces: vi.fn(),
    renderProgress: vi.fn(),
  };
}

describe("runTranscribeStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTranscriptionMock.mockRejectedValue(new Error("cache miss"));
    transcribeMock.mockResolvedValue({
      id: "transcription-1",
      mediaFileId: "media-1",
      engine: "parakeet_local",
      segments: [],
      words: [],
    });
  });

  it("reuses one prepared audio result for the RMS envelope and Parakeet", async () => {
    const pcm16k = new Float32Array([0.25, -0.25, 0.5, -0.5]);
    const audioFile = new File([new Uint8Array([1, 2])], "clip-audio.mp3", {
      type: "audio/mpeg",
    });
    extractAudioMock.mockResolvedValue({ file: audioFile, pcm16k });
    const session = createSession();

    await runTranscribeStage(
      session,
      {
        projectId: "project-1",
        snappedStart: 2,
        end: 7,
        clipDuration: 5,
        trimUnchanged: false,
        existingWords: [],
        engine: "parakeet_local",
      },
      createReporter(),
      { signal: new AbortController().signal },
    );

    expect(extractAudioMock).toHaveBeenCalledOnce();
    expect(session.audioEnvelope?.values.length).toBeGreaterThan(0);
    expect(transcribeMock).toHaveBeenCalledWith(
      audioFile,
      "media-1",
      "project-1",
      expect.objectContaining({
        engine: "parakeet_local",
        pcm16k,
      }),
    );
  });

  it("keeps API transcription on the MP3 upload without exposing PCM", async () => {
    const pcm16k = new Float32Array([0.1, -0.1]);
    const audioFile = new File([new Uint8Array([1])], "clip-audio.mp3", {
      type: "audio/mpeg",
    });
    extractAudioMock.mockResolvedValue({ file: audioFile, pcm16k });
    transcribeMock.mockResolvedValue({
      id: "transcription-2",
      mediaFileId: "media-1",
      engine: "api",
      segments: [],
      words: [],
    });

    await runTranscribeStage(
      createSession(),
      {
        projectId: "project-1",
        snappedStart: 0,
        end: 3,
        clipDuration: 3,
        trimUnchanged: false,
        existingWords: [],
        engine: "api",
      },
      createReporter(),
      { signal: new AbortController().signal },
    );

    expect(transcribeMock).toHaveBeenCalledWith(
      audioFile,
      "media-1",
      "project-1",
      expect.objectContaining({ engine: "api", pcm16k: undefined }),
    );
  });
});
