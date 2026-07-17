import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../utils/platform", () => ({ isTauri: () => true }));

import {
  localProjectList,
  localRecordGet,
} from "./local-database";

describe("native local database reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coalesces concurrent reads of the same record without caching the result", async () => {
    let resolveRead!: (value: { id: string } | null) => void;
    invokeMock.mockImplementation(
      () =>
        new Promise<{ id: string } | null>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const first = localRecordGet<{ id: string }>("record", "same-key");
    const second = localRecordGet<{ id: string }>("record", "same-key");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    resolveRead({ id: "first" });
    await expect(first).resolves.toEqual({ id: "first" });
    await expect(second).resolves.toEqual({ id: "first" });

    await Promise.resolve();
    invokeMock.mockResolvedValueOnce({ id: "second" });
    await expect(localRecordGet<{ id: string }>("record", "same-key")).resolves.toEqual({
      id: "second",
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("keeps list requests with different parameters separate", async () => {
    invokeMock.mockResolvedValue({ data: [], total: 0 });

    await Promise.all([
      localProjectList({ ownerId: "owner", page: 1, limit: 10, projectType: "clipper" }),
      localProjectList({ ownerId: "owner", page: 2, limit: 10, projectType: "clipper" }),
    ]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("clears a failed read so a later caller can retry", async () => {
    invokeMock.mockRejectedValueOnce(new Error("temporary failure"));

    await expect(localRecordGet("record", "retry")).rejects.toThrow("temporary failure");
    await Promise.resolve();

    invokeMock.mockResolvedValueOnce({ recovered: true });
    await expect(localRecordGet("record", "retry")).resolves.toEqual({ recovered: true });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
