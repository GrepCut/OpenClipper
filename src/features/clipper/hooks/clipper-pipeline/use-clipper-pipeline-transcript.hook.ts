import { useCallback, useEffect, useRef, useState } from "react";

import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import type { ClipperGeneratedClip } from "../../engine/segmentation";
import {
  applyTranscriptPatches,
  buildTranscriptPatches,
  patchClipWords,
  type TranscriptEditOp,
  type TranscriptWordPatch,
} from "../../engine/transcript";
import type { WordCue } from "../../lib/media/transcription-export.util";
import { saveClipperRangeWords } from "../../persistence/clipper-range-words-api.util";
import { syncSessionActiveClips } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import type { ClipperClipPreview } from "../../shared/state.util";
import { activeClipPreviewsForMode } from "./clip-preview.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

const SAVE_DEBOUNCE_MS = 400;
const HISTORY_LIMIT = 100;

type PatchDirection = "forward" | "backward";

/**
 * Transcript word edits (fix text, delete/restore, merge a phrase) with undo/redo.
 * `rangeWords` is the source of truth; every clip's local word copies are patched in
 * place so captions, previews and render signatures follow without a re-segment.
 */
export function useClipperPipelineTranscript(core: UseClipperPipelineCoreResult) {
  const { projectId, setState, settings, refs } = core;
  const { sessionRef } = refs;
  const wordsPerGroup = captionWordsPerGroup(settings.captions);

  const undoStackRef = useRef<TranscriptWordPatch[][]>([]);
  const redoStackRef = useRef<TranscriptWordPatch[][]>([]);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ projectId: string; words: WordCue[] } | null>(null);

  const syncHistorySize = useCallback(() => {
    setHistorySize({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }, []);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current != null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) return;
    void saveClipperRangeWords(pending.projectId, pending.words).catch((error) =>
      clipperError("pipeline: save edited transcript failed", error),
    );
  }, []);

  const lastCommittedWordsRef = useRef<WordCue[] | null>(null);

  const resetHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastCommittedWordsRef.current = null;
    syncHistorySize();
  }, [syncHistorySize]);

  useEffect(() => {
    resetHistory();
    return flushSave;
  }, [flushSave, projectId, resetHistory]);

  /** Patches address words by index, so they are stale once anything else replaces `rangeWords` (e.g. a re-transcribed range). */
  const dropStaleHistory = useCallback(() => {
    const current = sessionRef.current?.rangeWords ?? null;
    const last = lastCommittedWordsRef.current;
    if (last && current !== last) resetHistory();
  }, [resetHistory, sessionRef]);

  const commitPatches = useCallback(
    (patches: TranscriptWordPatch[], direction: PatchDirection): boolean => {
      const session = sessionRef.current;
      if (!session || !patches.length) return false;

      const previous = session.rangeWords;
      const next = applyTranscriptPatches(previous, patches, direction);
      const patchesByIndex = new Map(
        patches.map((patch) => [
          patch.index,
          direction === "forward"
            ? { before: patch.before, after: patch.after }
            : { before: patch.after, after: patch.before },
        ]),
      );
      const patchClips = (clips: ClipperGeneratedClip[]) => {
        let changed = false;
        const patched = clips.map((clip) => {
          const nextClip = patchClipWords(clip, previous, patchesByIndex, wordsPerGroup);
          if (nextClip !== clip) changed = true;
          return nextClip;
        });
        return changed ? patched : clips;
      };

      session.rangeWords = next;
      lastCommittedWordsRef.current = next;
      if (session.words.length === previous.length) session.words = next;
      session.autoPartsClips = patchClips(session.autoPartsClips);
      session.aiClips = patchClips(session.aiClips);
      session.manualClips = patchClips(session.manualClips);
      syncSessionActiveClips(session);
      session.captionGroupsCache = null;

      const patchPreviews = (
        previews: ClipperClipPreview[],
        clips: ClipperGeneratedClip[],
      ) => {
        const clipsByIndex = new Map(clips.map((clip) => [clip.index, clip]));
        return previews.map((preview) => {
          const clip = clipsByIndex.get(preview.clip.index);
          return clip && clip !== preview.clip ? { ...preview, clip } : preview;
        });
      };

      setState((prev) => {
        const autoPartsClipPreviews = patchPreviews(
          prev.autoPartsClipPreviews ?? [],
          session.autoPartsClips,
        );
        const aiClipPreviews = patchPreviews(prev.aiClipPreviews ?? [], session.aiClips);
        const manualClipPreviews = patchPreviews(
          prev.manualClipPreviews ?? [],
          session.manualClips,
        );
        return {
          ...prev,
          rangeWords: next,
          autoPartsClipPreviews,
          aiClipPreviews,
          manualClipPreviews,
          clipPreviews: activeClipPreviewsForMode(
            prev.clipSourceMode,
            autoPartsClipPreviews,
            aiClipPreviews,
            manualClipPreviews,
          ),
        };
      });

      pendingSaveRef.current = { projectId, words: next };
      if (saveTimerRef.current != null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
      return true;
    },
    [flushSave, projectId, sessionRef, setState, wordsPerGroup],
  );

  /** Applies an edit; returns the patches it made ([] when nothing changed). */
  const applyTranscriptOp = useCallback(
    (op: TranscriptEditOp): TranscriptWordPatch[] => {
      const session = sessionRef.current;
      if (!session) return [];
      dropStaleHistory();
      const patches = buildTranscriptPatches(session.rangeWords, op);
      if (!commitPatches(patches, "forward")) return [];
      undoStackRef.current = [...undoStackRef.current, patches].slice(-HISTORY_LIMIT);
      redoStackRef.current = [];
      syncHistorySize();
      return patches;
    },
    [commitPatches, dropStaleHistory, sessionRef, syncHistorySize],
  );

  const undoTranscriptEdit = useCallback((): boolean => {
    dropStaleHistory();
    const patches = undoStackRef.current.at(-1);
    if (!patches || !commitPatches(patches, "backward")) return false;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, patches];
    syncHistorySize();
    return true;
  }, [commitPatches, dropStaleHistory, syncHistorySize]);

  const redoTranscriptEdit = useCallback((): boolean => {
    dropStaleHistory();
    const patches = redoStackRef.current.at(-1);
    if (!patches || !commitPatches(patches, "forward")) return false;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, patches];
    syncHistorySize();
    return true;
  }, [commitPatches, dropStaleHistory, syncHistorySize]);

  return {
    applyTranscriptOp,
    undoTranscriptEdit,
    redoTranscriptEdit,
    canUndoTranscriptEdit: historySize.undo > 0,
    canRedoTranscriptEdit: historySize.redo > 0,
  };
}
