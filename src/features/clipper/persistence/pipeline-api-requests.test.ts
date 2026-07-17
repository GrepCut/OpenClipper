import { beforeEach, describe, expect, it, vi } from "vitest";

const localRecordGetMock = vi.hoisted(() => vi.fn());
const localRecordPutMock = vi.hoisted(() => vi.fn());

vi.mock("../../../shared/persistence/local-database", () => ({
  localRecordDelete: vi.fn(),
  localRecordGet: localRecordGetMock,
  localRecordPut: localRecordPutMock,
}));

import { clipperPipelineService } from "./pipeline-api";

describe("clipper pipeline writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "step-id" });
    localRecordGetMock.mockImplementation((namespace: string) =>
      Promise.resolve(namespace === "clipper-pipeline-steps" ? [] : null),
    );
    localRecordPutMock.mockResolvedValue(undefined);
  });

  it("does not re-read pipeline steps after saving them", async () => {
    const projectId = "project-1";

    const state = await clipperPipelineService.upsertSteps(projectId, [
      { stepKey: "confirm_range", status: "completed" },
    ]);

    expect(localRecordGetMock).toHaveBeenNthCalledWith(
      1,
      "clipper-pipeline-steps",
      projectId,
    );
    expect(localRecordGetMock).toHaveBeenNthCalledWith(
      2,
      "clipper-face-analysis",
      projectId,
    );
    expect(localRecordGetMock).toHaveBeenCalledTimes(2);
    expect(localRecordPutMock).toHaveBeenCalledTimes(1);
    expect(state.steps).toHaveLength(1);
    expect(state.resumePlan.target).toBe("restoring");
  });
});
