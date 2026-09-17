import { appendUniqueExportResults } from "./export-results.util";
import { renderProgressKey } from "./render-progress.util";
import type { ClipperFormatResult, ClipperPipelineState } from "./state.util";

export type RenderBatchOutcome = "completed" | "aborted" | "failed";

export interface RenderExportsOptions {
  skipCompleted?: boolean;
  /** Leave out formats already exported from identical render inputs (persisted exports). */
  skipExisting?: boolean;
}

type RenderStopDraft = Pick<
  ClipperPipelineState,
  "stageMessage" | "stageProgress" | "error" | "renderProgress" | "clipPreviews" | "exportHistory"
>;

type RenderResultsDraft = RenderStopDraft & Pick<ClipperPipelineState, "renderSignatures">;

function clipIndexFromRenderProgressKey(key: string): number {
  const separator = key.indexOf(":");
  return separator === -1 ? Number.NaN : Number(key.slice(0, separator));
}

/** Progress entries whose clip still has the render signature it was exported with. */
export function withoutStaleRenderProgress(
  renderProgress: Record<string, number | null>,
  renderSignatures: Record<number, string>,
  currentSignatures: Record<number, string>,
): Record<string, number | null> {
  const fresh: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(renderProgress)) {
    const clipIndex = clipIndexFromRenderProgressKey(key);
    if (renderSignatures[clipIndex] === undefined) continue;
    if (renderSignatures[clipIndex] !== currentSignatures[clipIndex]) continue;
    fresh[key] = value;
  }
  return fresh;
}

export function remainingFormatIds(
  formatIdsByClip: Record<number, string[]>,
  renderProgress: Record<string, number | null>,
): Record<number, string[]> {
  const remaining: Record<number, string[]> = {};
  for (const [clipIndexKey, formatIds] of Object.entries(formatIdsByClip)) {
    const clipIndex = Number(clipIndexKey);
    const pending = formatIds.filter(
      (formatId) => renderProgress[renderProgressKey(clipIndex, formatId)] !== 1,
    );
    if (pending.length > 0) remaining[clipIndex] = pending;
  }
  return remaining;
}

function clipHasAllFormatsComplete(
  clipIndex: number,
  formatIds: string[],
  renderProgress: Record<string, number | null>,
): boolean {
  return (
    formatIds.length > 0 &&
    formatIds.every((formatId) => renderProgress[renderProgressKey(clipIndex, formatId)] === 1)
  );
}

/** Batch progress map: carried-over completed exports stay at 1, everything else starts empty. */
export function buildInitialRenderProgress(
  formatIdsByClip: Record<number, string[]>,
  completedProgress: Record<string, number | null>,
): Record<string, number | null> {
  const initial: Record<string, number | null> = {};
  for (const [clipIndexKey, formatIds] of Object.entries(formatIdsByClip)) {
    const clipIndex = Number(clipIndexKey);
    for (const formatId of formatIds) {
      const key = renderProgressKey(clipIndex, formatId);
      initial[key] = completedProgress[key] === 1 ? 1 : null;
    }
  }
  return initial;
}

export function applyRenderBatchStartState(
  draft: Pick<
    ClipperPipelineState,
    "stage" | "stageMessage" | "renderProgress" | "renderSignatures" | "error" | "clipPreviews"
  >,
  input: {
    clipCount: number;
    initialProgress: Record<string, number | null>;
    skipCompleted: boolean;
    selectedByClip: Record<number, string[]>;
  },
): void {
  draft.stage = "preview";
  draft.stageMessage = `Rendering ${input.clipCount} clip${input.clipCount > 1 ? "s" : ""}…`;
  draft.renderProgress = input.initialProgress;
  if (!input.skipCompleted) draft.renderSignatures = {};
  draft.error = null;
  for (const preview of draft.clipPreviews) {
    const clipIndex = preview.clip.index;
    const formatIds = input.selectedByClip[clipIndex];
    if (!formatIds?.length) continue;
    if (clipHasAllFormatsComplete(clipIndex, formatIds, input.initialProgress)) {
      preview.renderStatus = "done";
      preview.renderProgress = 1;
      continue;
    }
    preview.renderStatus = "queued";
    preview.renderProgress = null;
    const keepsCompletedExports = formatIds.some(
      (formatId) => input.initialProgress[renderProgressKey(clipIndex, formatId)] === 1,
    );
    if (!keepsCompletedExports) preview.results = [];
  }
}

export function applySuccessfulClipResults(
  draft: RenderResultsDraft,
  clipIndex: number,
  clipResults: ClipperFormatResult[],
  selectedFormatIds: string[],
  renderSignature: string,
): void {
  const preview = draft.clipPreviews.find((item) => item.clip.index === clipIndex);
  if (clipResults.length > 0) {
    draft.exportHistory = appendUniqueExportResults(draft.exportHistory, clipResults);
    draft.renderSignatures[clipIndex] = renderSignature;
    if (preview) preview.results = appendUniqueExportResults(preview.results, clipResults);
  }
  for (const result of clipResults) {
    draft.renderProgress[renderProgressKey(result.clipIndex, result.formatId)] = 1;
  }
  if (preview && clipHasAllFormatsComplete(clipIndex, selectedFormatIds, draft.renderProgress)) {
    preview.renderStatus = "done";
    preview.renderProgress = 1;
  }
}

export function applyRenderStopState(draft: RenderStopDraft): void {
  const total = Object.keys(draft.renderProgress).length;
  const done = Object.values(draft.renderProgress).filter((value) => value === 1).length;

  for (const key of Object.keys(draft.renderProgress)) {
    if (draft.renderProgress[key] !== 1) draft.renderProgress[key] = null;
  }

  for (const preview of draft.clipPreviews) {
    if (preview.renderStatus !== "queued" && preview.renderStatus !== "rendering") continue;
    const clipKeys = Object.entries(draft.renderProgress).filter(
      ([key]) => clipIndexFromRenderProgressKey(key) === preview.clip.index,
    );
    const allDone = clipKeys.length > 0 && clipKeys.every(([, value]) => value === 1);
    if (allDone) {
      preview.renderStatus = "done";
      preview.renderProgress = 1;
    } else {
      preview.renderStatus = "idle";
      preview.renderProgress = null;
    }
  }

  draft.stageProgress = null;
  draft.error = null;
  draft.stageMessage =
    total === 0 ? "Rendering stopped" : `Rendering stopped · ${done} of ${total} exports complete`;
}

export function applyRenderFailureState(
  draft: Pick<ClipperPipelineState, "stage" | "stageMessage" | "stageProgress" | "error" | "clipPreviews">,
  message: string,
  failedClipIndex: number | null,
): void {
  draft.stage = "preview";
  draft.stageMessage = "Render failed, adjust preview and try again";
  draft.stageProgress = null;
  draft.error = message;
  for (const preview of draft.clipPreviews) {
    if (preview.clip.index === failedClipIndex) {
      preview.renderStatus = "error";
    } else if (preview.renderStatus === "rendering" || preview.renderStatus === "queued") {
      preview.renderStatus = "idle";
      preview.renderProgress = null;
    }
  }
}
