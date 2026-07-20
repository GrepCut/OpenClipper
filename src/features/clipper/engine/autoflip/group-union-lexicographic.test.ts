import { describe, expect, it } from "vitest";
import type { ImportanceRegion } from "../../shared/smart-crop";
import { groupUnionLexicographicOk } from "./layout-planner";

function region(id: string, box: { x: number; y: number; width: number; height: number }): ImportanceRegion {
  return {
    id,
    kind: "person",
    box,
    contentBox: box,
    importanceScore: 1,
    confidence: 1,
    sources: ["person"],
    required: true,
    role: "primary",
  };
}

describe("groupUnionLexicographicOk", () => {
  it("rejects group union when crop area grows versus fallback", () => {
    const required = [region("a", { x: 0.1, y: 0.1, width: 0.2, height: 0.7 })];
    const group = { x: 0, y: 0, width: 1, height: 1 };
    const fallback = { x: 0.2, y: 0, width: 0.5, height: 1 };
    expect(groupUnionLexicographicOk(group, fallback, required)).toBe(false);
  });

  it("accepts tighter group union with equal subject height", () => {
    const required = [region("a", { x: 0.2, y: 0.1, width: 0.2, height: 0.7 })];
    const group = { x: 0.15, y: 0, width: 0.35, height: 1 };
    const fallback = { x: 0.1, y: 0, width: 0.5, height: 1 };
    expect(groupUnionLexicographicOk(group, fallback, required)).toBe(true);
  });
});
