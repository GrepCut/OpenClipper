import { describe, expect, it } from "vitest";
import { isRestoredSmartCropAnalysisValid } from "./is-restored-analysis-valid";

const VERSION = "autoflip-v19-no-centroid-track";

describe("isRestoredSmartCropAnalysisValid", () => {
  it("accepts a blob with aspect track samples and matching clip range", () => {
    expect(isRestoredSmartCropAnalysisValid(
      {
        clipStart: 0,
        clipEnd: 10,
        aspectTracks: { tiktok: { samples: [{ t: 0 }, { t: 0.2 }] } },
      },
      { start: 0, end: 10, version: VERSION, blobVersion: VERSION },
    )).toBe(true);
  });

  it("rejects blobs without aspect track samples", () => {
    expect(isRestoredSmartCropAnalysisValid(
      { clipStart: 0, clipEnd: 10, aspectTracks: { tiktok: { samples: [] } } },
      { start: 0, end: 10, version: VERSION, blobVersion: VERSION },
    )).toBe(false);
    expect(isRestoredSmartCropAnalysisValid(
      { clipStart: 0, clipEnd: 10 },
      { start: 0, end: 10, version: VERSION, blobVersion: VERSION },
    )).toBe(false);
  });

  it("rejects stale analyzer versions and clip range mismatches", () => {
    const blob = {
      clipStart: 0,
      clipEnd: 10,
      aspectTracks: { tiktok: { samples: [{ t: 0 }] } },
    };
    expect(isRestoredSmartCropAnalysisValid(
      blob,
      { start: 0, end: 10, version: VERSION, blobVersion: "autoflip-v18-generalization" },
    )).toBe(false);
    expect(isRestoredSmartCropAnalysisValid(
      blob,
      { start: 1, end: 10, version: VERSION, blobVersion: VERSION },
    )).toBe(false);
  });
});
