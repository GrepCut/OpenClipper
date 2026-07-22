import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "./one-euro-filter";

describe("OneEuroFilter", () => {
  it("reduces low-speed jitter while retaining a fast move", () => {
    const filter = new OneEuroFilter();
    const values = [0.5, 0.501, 0.499, 0.502, 0.8];
    const output = values.map((value, index) => filter.filter(value, index * 0.2));
    expect(Math.abs(output[3]! - 0.5)).toBeLessThan(Math.abs(values[3]! - 0.5));
    expect(output[4]).toBeGreaterThan(0.75);
  });

  it("resets deterministically", () => {
    const filter = new OneEuroFilter();
    filter.filter(0.2, 0);
    filter.filter(0.3, 0.2);
    filter.reset();
    expect(filter.filter(0.8, 1)).toBe(0.8);
  });
});
