import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairAutoPartsBoundaries } from "./boundaries.util";

describe("repairAutoPartsBoundaries", () => {
  it("extends the first clip to 0 instead of creating an orphan head segment", () => {
    const clips = [{ startSec: 0.88, endSec: 70 }];

    const repaired = repairAutoPartsBoundaries(70, clips, 60);

    assert.equal(repaired.length, 1);
    assert.ok(Math.abs(repaired[0].startSec - 0) < 0.05);
    assert.ok(Math.abs(repaired[0].endSec - 70) < 0.05);
  });
});
