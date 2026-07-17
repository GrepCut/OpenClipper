import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { projectsService } from "./projects.service";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("projectsService guest workspace", () => {
  beforeAll(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", memoryStorage());
  });
  beforeEach(() => localStorage.clear());

  it("creates a guest project in the installation workspace", async () => {
    const project = await projectsService.create({ name: "Guest project" });

    expect(project.user).toBeNull();
    const listed = await projectsService.getAll();
    expect(listed.data).toEqual([
      expect.objectContaining({ id: project.id, name: "Guest project", user: null }),
    ]);
  });
});
