import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, localRecordGetMock, localRecordPutMock, runNativeJobMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    localRecordGetMock: vi.fn(),
    localRecordPutMock: vi.fn(),
    runNativeJobMock: vi.fn(),
  }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("../shared/utils/platform", () => ({ isTauri: () => true }));

vi.mock("../shared/persistence/local-database", () => ({
  localRecordGet: localRecordGetMock,
  localRecordPut: localRecordPutMock,
}));

vi.mock("../features/clipper/persistence/project-data-files", () => ({
  ensureClipperProjectDataDir: vi.fn(),
}));

vi.mock("../shared/utils/tauri-native-jobs", () => ({
  createTauriNativeJobId: () => "parakeet-job-1",
  runTauriNativeJob: runNativeJobMock,
}));

import { transcriptionService } from "./transcription.service";

describe("transcriptionService local Parakeet audio preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localRecordGetMock.mockResolvedValue(null);
    localRecordPutMock.mockResolvedValue(undefined);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_clipper_project_data_file_path") {
        return Promise.resolve("C:\\project\\transcribe-audio.wav");
      }
      return Promise.resolve(undefined);
    });
    runNativeJobMock.mockResolvedValue({ segments: [], words: [] });
  });

  it("writes supplied mono 16 kHz PCM as a valid WAV before starting Parakeet", async () => {
    const pcm16k = new Float32Array([-1, -0.25, 0, 0.25, 1]);

    await transcriptionService.transcribe(
      new File([new Uint8Array([0xff])], "clip-audio.mp3", {
        type: "audio/mpeg",
      }),
      "media-1",
      "project-1",
      { engine: "parakeet_local", pcm16k },
    );

    const writeCall = invokeMock.mock.calls.find(
      ([command]) => command === "write_clipper_project_data_raw",
    );
    expect(writeCall).toBeDefined();
    const contents = writeCall?.[1] as Uint8Array;
    const view = new DataView(
      contents.buffer,
      contents.byteOffset,
      contents.byteLength,
    );

    expect(new TextDecoder().decode(contents.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(contents.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm16k.length * 2);
    expect(writeCall?.[2]).toEqual({
      headers: {
        "x-clipper-project-id": "project-1",
        "x-clipper-file-name": "transcribe-audio.wav",
      },
    });
    expect(runNativeJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startCommand: "start_parakeet_transcription",
        args: {
          request: {
            audioPath: "C:\\project\\transcribe-audio.wav",
            language: "pl",
          },
        },
      }),
    );
  });

  it("fails clearly when local PCM was not prepared", async () => {
    await expect(
      transcriptionService.transcribe(
        new File([new Uint8Array([0xff])], "clip-audio.mp3"),
        "media-2",
        "project-1",
        { engine: "parakeet_local" },
      ),
    ).rejects.toThrow("Local transcription audio is unavailable");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(runNativeJobMock).not.toHaveBeenCalled();
  });
});
