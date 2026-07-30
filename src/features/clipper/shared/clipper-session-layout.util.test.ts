import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveClipperSessionVisibility } from "./clipper-session-layout.util";
import type { ClipperLoadedProject } from "../hooks/use-clipper-project-loader.hook";

function baseInput(
  overrides: Partial<Parameters<typeof resolveClipperSessionVisibility>[0]> = {},
) {
  return {
    stage: "uploading" as const,
    view: "preview" as const,
    isRendering: false,
    exportCount: 0,
    loaded: {
      resumePlan: { target: "restoring" },
    } as ClipperLoadedProject,
    clipPreviewsLength: 0,
    autoPartsClipPreviewsLength: 0,
    rangeTrimmedVideoUrl: null,
    onBackToPreview: () => {},
    onBackToRenderQueue: () => {},
    ...overrides,
  };
}

describe("resolveClipperSessionVisibility", () => {
  it("shows restore loader when restoring with no clips yet", () => {
    const visibility = resolveClipperSessionVisibility(baseInput());
    assert.equal(visibility.showRestoreLoader, true);
    assert.equal(visibility.showPreview, false);
    assert.equal(visibility.previewKeepAlive, false);
  });

  it("shows early preview shell when clips exist without video URL during restore", () => {
    const visibility = resolveClipperSessionVisibility(
      baseInput({
        clipPreviewsLength: 3,
        autoPartsClipPreviewsLength: 3,
        rangeTrimmedVideoUrl: null,
        stage: "uploading",
      }),
    );
    assert.equal(visibility.showRestoreLoader, false);
    assert.equal(visibility.showPreview, true);
    assert.equal(visibility.previewKeepAlive, true);
    assert.equal(visibility.showQueueSetup, false);
  });

  it("keeps preview mounted but hidden on queue view once fully ready", () => {
    const visibility = resolveClipperSessionVisibility(
      baseInput({
        stage: "preview",
        view: "queue",
        clipPreviewsLength: 2,
        autoPartsClipPreviewsLength: 2,
        rangeTrimmedVideoUrl: "blob:preview",
        loaded: { resumePlan: { target: "restoring" } } as ClipperLoadedProject,
      }),
    );
    assert.equal(visibility.showPreview, false);
    assert.equal(visibility.previewKeepAlive, true);
    assert.equal(visibility.showQueueSetup, true);
  });
});
