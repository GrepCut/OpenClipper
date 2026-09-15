import { useCallback } from "react";

import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import {
  buildClipsFromWordRanges,
  clipPayloadFromWordRanges,
  deriveWordRangesFromClip,
  type AiClipSegmentRange,
  type AiClipWordRange,
} from "../../engine/transcript";
import {
  resolveActiveClipIndexAfterDelete,
  sortClipsByIndex,
} from "../../engine/segmentation";
import {
  saveClipperClips,
  type ClipperClipPayload,
} from "../../persistence/clipper-clips-api.util";
import { syncSessionActiveClips, type ClipperSession } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import {
  buildClipPreviews,
  payloadClipToWordSegments,
} from "./clip-preview.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineManual(core: UseClipperPipelineCoreResult) {
  const { projectId, setState, settings, refs, persistMetadata } = core;
  const { sessionRef, activeClipIndexRef, manualClipsMetaRef } = refs;
  const wordsPerGroup = captionWordsPerGroup(settings.captions);

  /**
   * Word ranges of the current manual clips, taken from the persisted word indices.
   * Re-deriving them from padded clip times can pull in neighbouring words.
   */
  const currentManualRanges = useCallback(
    (session: ClipperSession): AiClipWordRange[] => {
      const metaByIndex = new Map(manualClipsMetaRef.current.map((clip) => [clip.index, clip]));
      return (session.manualClips ?? []).flatMap((clip) => {
        const meta = metaByIndex.get(clip.index);
        const fromMeta = meta ? payloadClipToWordSegments(meta) : [];
        const metaInBounds = fromMeta.every(
          (segment) =>
            segment.wordStartIdx >= 0 &&
            segment.wordStartIdx <= segment.wordEndIdx &&
            segment.wordEndIdx < session.rangeWords.length,
        );
        const segments = fromMeta.length && metaInBounds
          ? fromMeta
          : deriveWordRangesFromClip(clip, session.rangeWords);
        return segments.length ? [{ index: clip.index, segments }] : [];
      });
    },
    [manualClipsMetaRef],
  );

  const applyManualClips = useCallback(
    (ranges: AiClipWordRange[], selectIndex?: number) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const rangeDurationSec = session.rangeEnd - session.rangeStart;
      const envelope = session.audioEnvelope ?? undefined;
      const manualClips = sortClipsByIndex(
        buildClipsFromWordRanges(
          session.rangeWords,
          ranges,
          wordsPerGroup,
          rangeDurationSec,
          undefined,
          envelope,
        ),
      );

      session.manualClips = manualClips;
      if (session.clipSourceMode === "manual") {
        syncSessionActiveClips(session);
      }
      session.captionGroupsCache = null;

      const builtIndexes = new Set(manualClips.map((clip) => clip.index));
      const payload = ranges
        .filter((range) => range.index != null && builtIndexes.has(range.index))
        .map((range) =>
          clipPayloadFromWordRanges(
            range.index!,
            range.segments,
            session.rangeWords,
            range.label,
            rangeDurationSec,
            undefined,
            envelope,
          ),
        )
        .filter((clip): clip is ClipperClipPayload => clip != null)
        .sort((a, b) => a.index - b.index);
      manualClipsMetaRef.current = payload;
      void saveClipperClips(projectId, "manual", payload).catch((error) =>
        clipperError("pipeline: save manual clips failed", error),
      );

      const manualClipPreviews = buildClipPreviews(manualClips);
      setState((prev) => {
        const fallback =
          manualClips.some((clip) => clip.index === prev.activeClipIndex)
            ? prev.activeClipIndex
            : manualClips[0]?.index ?? 0;
        const nextActive =
          prev.clipSourceMode === "manual"
            ? selectIndex != null && manualClips.some((clip) => clip.index === selectIndex)
              ? selectIndex
              : fallback
            : prev.activeClipIndex;
        if (prev.clipSourceMode === "manual") {
          activeClipIndexRef.current = nextActive;
          session.activeClipIndex = nextActive;
        }
        return {
          ...prev,
          manualClipPreviews,
          clipPreviews:
            prev.clipSourceMode === "manual" ? manualClipPreviews : prev.clipPreviews,
          activeClipIndex: nextActive,
        };
      });
    },
    [activeClipIndexRef, manualClipsMetaRef, projectId, sessionRef, setState, wordsPerGroup],
  );

  const upsertManualClip = useCallback(
    (range: AiClipSegmentRange, editIndex?: number) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const segment: AiClipSegmentRange = {
        wordStartIdx: Math.min(range.wordStartIdx, range.wordEndIdx),
        wordEndIdx: Math.max(range.wordStartIdx, range.wordEndIdx),
      };
      const existing = currentManualRanges(session);

      if (editIndex != null) {
        const next = existing.map((clipRange) =>
          clipRange.index === editIndex
            ? { ...clipRange, segments: [segment] }
            : clipRange,
        );
        if (!next.some((clipRange) => clipRange.index === editIndex)) {
          next.push({ index: editIndex, segments: [segment] });
        }
        applyManualClips(next, editIndex);
        return;
      }

      const nextIndex = existing.length
        ? Math.max(...existing.map((clipRange) => clipRange.index ?? 0)) + 1
        : 0;
      applyManualClips([...existing, { index: nextIndex, segments: [segment] }], nextIndex);
    },
    [applyManualClips, currentManualRanges, sessionRef],
  );

  const deleteManualClip = useCallback(
    (index: number) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const previousActive = activeClipIndexRef.current;
      const remainingClips = (session.manualClips ?? []).filter((clip) => clip.index !== index);
      const remaining = currentManualRanges(session).filter(
        (clipRange) => clipRange.index !== index,
      );
      const nextActive = resolveActiveClipIndexAfterDelete(
        previousActive,
        index,
        remainingClips,
      );
      applyManualClips(remaining, nextActive);
      persistMetadata({ activeClipIndex: nextActive });
    },
    [activeClipIndexRef, applyManualClips, currentManualRanges, persistMetadata, sessionRef],
  );

  return {
    upsertManualClip,
    deleteManualClip,
  };
}
