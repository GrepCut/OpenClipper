import {
  rebuildClipsFromGeneratedMetadata,
  sortClipsByIndex,
  type ClipperGeneratedClip,
} from "../../engine/segmentation";
import { buildClipsFromWordRanges, clipPayloadFromWordRanges, deriveWordRangesFromClip } from "../../engine/transcript";
import type { RmsEnvelope } from "../../engine/types/audio.types";
import type { WordCue } from "../../lib/media/transcription-export.util";
import type { ClipperClipPayload } from "../../persistence/clipper-clips-api.util";
import { getActiveClips, type ClipperSession } from "../../pipeline/session.util";
import type { ClipperClipPreview, ClipperPipelineState, ClipSourceMode } from "../../shared/state.util";

export function buildClipPreviews(clips: ClipperGeneratedClip[]): ClipperClipPreview[] {
  return sortClipsByIndex(clips).map((clip) => ({
    clip,
    renderStatus: "idle" as const,
    renderProgress: null,
    results: [],
  }));
}

export function clipsToPayload(
  clips: ClipperGeneratedClip[],
  rangeWords?: WordCue[],
  rangeDurationSec = Infinity,
  envelope?: RmsEnvelope,
): ClipperClipPayload[] {
  return clips.map((clip) => {
    if (rangeWords?.length) {
      const ranges = deriveWordRangesFromClip(clip, rangeWords);
      const withIndices = clipPayloadFromWordRanges(
        clip.index,
        ranges,
        rangeWords,
        undefined,
        rangeDurationSec,
        undefined,
        envelope,
      );
      if (withIndices) return withIndices;
    }
    return {
      index: clip.index,
      startSec: clip.startSec,
      endSec: clip.endSec,
      segments: clip.segments.map((seg, orderIndex) => ({
        orderIndex,
        startSec: seg.startSec,
        endSec: seg.endSec,
      })),
    };
  });
}

/** Auto-parts delete must match what the clip list shows (state previews can outlive session). */
export function resolveAutoPartsClips(
  session: ClipperSession,
  prev: ClipperPipelineState,
): ClipperGeneratedClip[] {
  if (session.autoPartsClips.length > 0) return session.autoPartsClips;

  const fromPreviews = (
    prev.autoPartsClipPreviews.length > 0
      ? prev.autoPartsClipPreviews
      : prev.clipSourceMode !== "ai"
        ? prev.clipPreviews
        : []
  ).map((preview) => preview.clip);
  if (fromPreviews.length > 0) return fromPreviews;

  return session.clipSourceMode !== "ai" ? getActiveClips(session) : [];
}

/** Word-index segments for one persisted clip, when every segment has them (falls back to time-only rebuild otherwise). */
export function payloadClipToWordSegments(
  clip: ClipperClipPayload,
): Array<{ wordStartIdx: number; wordEndIdx: number }> {
  if (!clip.segments.length) return [];
  const hasAll = clip.segments.every((s) => s.wordStartIdx != null && s.wordEndIdx != null);
  if (!hasAll) return [];
  return clip.segments.map((s) => ({ wordStartIdx: s.wordStartIdx!, wordEndIdx: s.wordEndIdx! }));
}

/** Rebuilds full clip objects from DB-persisted boundaries (auto-parts: always time-only; AI: word-index when available). */
export function rebuildClipsFromDbPayload(
  dbClips: ClipperClipPayload[],
  rangeWords: WordCue[],
  wordsPerGroup: number,
  rangeDurationSec = Infinity,
  envelope?: RmsEnvelope,
): ClipperGeneratedClip[] {
  if (!dbClips.length || !rangeWords.length) return [];

  const hasWordIndices = dbClips.every((clip) => payloadClipToWordSegments(clip).length > 0);

  if (hasWordIndices) {
    return buildClipsFromWordRanges(
      rangeWords,
      dbClips.map((clip) => ({
        segments: payloadClipToWordSegments(clip),
        label: clip.label,
        index: clip.index,
      })),
      wordsPerGroup,
      rangeDurationSec,
      undefined,
      envelope,
    );
  }

  return rebuildClipsFromGeneratedMetadata(
    dbClips.map((clip) => ({
      index: clip.index,
      startSec: clip.startSec,
      endSec: clip.endSec,
    })),
    rangeWords,
    wordsPerGroup,
  );
}

export function activeClipPreviewsForMode(
  mode: ClipSourceMode,
  autoPartsClipPreviews: ClipperClipPreview[],
  aiClipPreviews: ClipperClipPreview[],
): ClipperClipPreview[] {
  return mode === "ai" ? aiClipPreviews : autoPartsClipPreviews;
}
