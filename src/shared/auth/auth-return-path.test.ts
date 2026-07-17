import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeAuthReturnPath,
  isSafeInternalReturnPath,
  rememberAuthReturnPath,
} from "./auth-return-path";

describe("auth return path", () => {
  beforeAll(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  beforeEach(() => sessionStorage.clear());

  it("round-trips an internal Clipper route once", () => {
    rememberAuthReturnPath("/clipper/project-1?tab=exports");
    expect(consumeAuthReturnPath()).toBe("/clipper/project-1?tab=exports");
    expect(consumeAuthReturnPath()).toBe("/clipper");
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(isSafeInternalReturnPath("https://example.com")).toBe(false);
    expect(isSafeInternalReturnPath("//example.com/path")).toBe(false);
    expect(isSafeInternalReturnPath("/\\example.com")).toBe(false);
    expect(isSafeInternalReturnPath("/clipper")).toBe(true);
  });
});
