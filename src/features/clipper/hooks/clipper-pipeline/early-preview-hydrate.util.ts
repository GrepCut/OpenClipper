import {
  rebuildClipsFromGeneratedMetadata,
  type ClipperClipBounds,
} from "../../engine/segmentation";
import type { WordCue } from "../../lib/media/transcription-export.util";
import type { ClipSourceMode, ClipperPipelineState } from "../../shared/state.util";
import {
  activeClipPreviewsForMode,
  buildClipPreviews,
  rebuildClipsFromDbPayload,
} from "./clip-preview.util";
import type { ClipperClipPayload } from "../../persistence/clipper-clips-api.util";

/** Builds an early preview state patch from DB clip boundaries + range words. */
export function buildEarlyPreviewStatePatch(input: {
  clipsForResume: ClipperClipBounds[];
  aiDbClips: ClipperClipPayload[];
  manualDbClips: ClipperClipPayload[];
  words: WordCue[];
  wordsPerGroup: number;
  rangeDuration: number;
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  snappedStart: number;
  end: number;
}): Partial<ClipperPipelineState> | null {
  const {
    clipsForResume,
    aiDbClips,
    manualDbClips,
    words,
    wordsPerGroup,
    rangeDuration,
    clipSourceMode,
    activeClipIndex,
    snappedStart,
    end,
  } = input;

  const earlyAutoPartsClips =
    clipsForResume.length === 0
      ? []
      : rebuildClipsFromGeneratedMetadata(clipsForResume, words, wordsPerGroup);
  const earlyAiClips =
    words.length > 0
      ? rebuildClipsFromDbPayload(aiDbClips, words, wordsPerGroup, rangeDuration)
      : [];
  const earlyManualClips =
    words.length > 0
      ? rebuildClipsFromDbPayload(manualDbClips, words, wordsPerGroup, rangeDuration)
      : [];
  const earlyAutoPartsPreviews = buildClipPreviews(earlyAutoPartsClips);
  const earlyAiPreviews = buildClipPreviews(earlyAiClips);
  const earlyManualPreviews = buildClipPreviews(earlyManualClips);
  const earlyClipPreviews = activeClipPreviewsForMode(
    clipSourceMode,
    earlyAutoPartsPreviews,
    earlyAiPreviews,
    earlyManualPreviews,
  );

  if (earlyClipPreviews.length === 0 && words.length === 0) return null;

  const earlyActive = Math.min(
    activeClipIndex,
    Math.max(0, earlyClipPreviews.length - 1),
  );

  return {
    rangeWords: words,
    clipPreviews: earlyClipPreviews,
    autoPartsClipPreviews: earlyAutoPartsPreviews,
    aiClipPreviews: earlyAiPreviews,
    manualClipPreviews: earlyManualPreviews,
    clipSourceMode,
    activeClipIndex: earlyClipPreviews.length > 0 ? earlyActive : activeClipIndex,
    clipStart: snappedStart,
    clipEnd: end,
    clipDuration: rangeDuration,
  };
}

/** Merges an early preview patch without wiping existing previews with empty arrays. */
export function mergeEarlyPreviewPatch(
  prev: ClipperPipelineState,
  patch: Partial<ClipperPipelineState>,
): ClipperPipelineState {
  return {
    ...prev,
    ...patch,
    clipPreviews:
      (patch.clipPreviews?.length ?? 0) > 0 ? patch.clipPreviews! : prev.clipPreviews,
    autoPartsClipPreviews:
      (patch.autoPartsClipPreviews?.length ?? 0) > 0
        ? patch.autoPartsClipPreviews!
        : prev.autoPartsClipPreviews,
    aiClipPreviews:
      (patch.aiClipPreviews?.length ?? 0) > 0 ? patch.aiClipPreviews! : prev.aiClipPreviews,
    manualClipPreviews:
      (patch.manualClipPreviews?.length ?? 0) > 0
        ? patch.manualClipPreviews!
        : prev.manualClipPreviews,
  };
}
