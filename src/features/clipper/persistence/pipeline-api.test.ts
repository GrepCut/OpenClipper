import { beforeEach, describe, expect, it, vi } from "vitest";
import { clipperPipelineService } from "./pipeline-api";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("local Clipper pipeline persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });
  });

  it("builds a restore plan from locally completed steps", async () => {
    const projectId = "00000000-0000-4000-8000-000000000010";
    await clipperPipelineService.upsertSteps(projectId, [
      { stepKey: "confirm_range", status: "completed" },
      { stepKey: "transcribe", status: "completed" },
      { stepKey: "analyze_faces", status: "completed" },
    ]);

    const state = await clipperPipelineService.getPipeline(projectId);
    expect(state.resumePlan).toEqual({
      target: "restoring",
      skipTranscribe: true,
      skipFaceDetect: true,
      skipSubjectAnalysis: false,
      skipToPreview: false,
    });
  });

  it("resets steps and face analysis together", async () => {
    const projectId = "00000000-0000-4000-8000-000000000020";
    await clipperPipelineService.upsertSteps(projectId, [
      { stepKey: "confirm_range", status: "completed" },
    ]);
    await clipperPipelineService.upsertFaceAnalysis(projectId, {
      mediaFileId: "00000000-0000-4000-8000-000000000021",
      clipStart: 0,
      clipEnd: 10,
      detectorVersion: "test",
      sampleCount: 2,
      localDataPath: "face.json",
      status: "completed",
    });

    await clipperPipelineService.resetPipeline(projectId);
    const state = await clipperPipelineService.getPipeline(projectId);
    expect(state.steps).toEqual([]);
    expect(state.faceAnalysis).toBeNull();
    expect(state.resumePlan.target).toBe("trimming");
  });
});
