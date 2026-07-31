import type { ClipperClipPayload } from "./clipper-clips-api.util";

/** Polling interval for AI clips written by MCP agents. */
export const CLIPPER_AI_CLIPS_EXTERNAL_SYNC_MS = 500;

function clipVisualKey(clip: ClipperClipPayload): string {
  const segments = clip.segments
    .map(
      (segment) =>
        `${segment.orderIndex}:${segment.wordStartIdx ?? ""}:${segment.wordEndIdx ?? ""}:${segment.startSec}:${segment.endSec}`,
    )
    .join("|");
  return `${clip.index}\0${clip.label ?? ""}\0${clip.startSec}\0${clip.endSec}\0${segments}`;
}

/** True when persisted AI clip payloads match for UI purposes. */
export function aiClipsVisuallyEqual(
  prev: ClipperClipPayload[],
  next: ClipperClipPayload[],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (clipVisualKey(prev[i]!) !== clipVisualKey(next[i]!)) return false;
  }
  return true;
}
