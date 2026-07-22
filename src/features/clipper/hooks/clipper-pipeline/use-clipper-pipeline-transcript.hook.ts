import { useCallback, useState } from "react";

import { sortClipsByIndex } from "../../engine/segmentation";
import {
  applyClipTranscriptEdit,
  clipPayloadFromWordRanges,
  deriveWordRangesFromClip,
  rebuildClipFromWordRanges,
  type ClipTranscriptEditOp,
} from "../../engine/transcript";
import { saveClipperClips } from "../../persistence/clipper-clips-api.util";
import { getActiveClips, syncSessionActiveClips } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import {
  activeClipPreviewsForMode,
  buildClipPreviews,
  clipsToPayload,
} from "./clip-preview.util";
import { CLIP_EDIT_HISTORY_MAX, type ClipEditSnapshot } from "./clipper-pipeline.types";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

interface UseClipperPipelineTranscriptDeps {
  deleteAiClip: (index: number) => void;
  deleteAutoPartsClip: (index: number) => void;
  applyAiClipsAndPersist: (
    aiClips: ReturnType<typeof import("../../engine/transcript").buildClipsFromWordRanges>,
    aiGeneratedClips: import("../../persistence/clipper-clips-api.util").ClipperClipPayload[],
  ) => void;
}

export function useClipperPipelineTranscript(
  core: UseClipperPipelineCoreResult,
  { deleteAiClip, deleteAutoPartsClip, applyAiClipsAndPersist }: UseClipperPipelineTranscriptDeps,
) {
  const { projectId, setState, settings, refs } = core;
  const {
    sessionRef,
    aiClipsMetaRef,
    clipEditUndoStackRef,
    clipEditRedoStackRef,
    transcriptClipboardRef,
    lastEditedTranscriptRangeRef,
  } = refs;

  const [lastEditedTranscriptRange, setLastEditedTranscriptRange] = useState<{
    clipIndex: number;
    startIdx: number;
    endIdx: number;
  } | null>(null);
  const [canUndoClipEdit, setCanUndoClipEdit] = useState(false);
  const [canRedoClipEdit, setCanRedoClipEdit] = useState(false);

  const captureClipEditSnapshot = useCallback((): ClipEditSnapshot | null => {
    const session = sessionRef.current;
    if (!session) return null;
    return {
      mode: session.clipSourceMode ?? "auto-parts",
      autoPartsClips: session.autoPartsClips.map((clip) => ({ ...clip })),
      aiClips: session.aiClips.map((clip) => ({ ...clip })),
      aiMeta: [...aiClipsMetaRef.current],
      lastEditedRange: lastEditedTranscriptRangeRef.current,
    };
  }, [aiClipsMetaRef, lastEditedTranscriptRangeRef, sessionRef]);

  const restoreClipEditSnapshot = useCallback(
    (snapshot: ClipEditSnapshot) => {
      const session = sessionRef.current;
      if (!session) return;

      session.autoPartsClips = snapshot.autoPartsClips;
      session.aiClips = snapshot.aiClips;
      aiClipsMetaRef.current = snapshot.aiMeta;
      syncSessionActiveClips(session);
      session.captionGroupsCache = null;
      lastEditedTranscriptRangeRef.current = snapshot.lastEditedRange;
      setLastEditedTranscriptRange(snapshot.lastEditedRange);

      void saveClipperClips(
        projectId,
        "auto-parts",
        clipsToPayload(snapshot.autoPartsClips, session.rangeWords),
      ).catch((error) =>
        clipperError("pipeline: save auto-parts clips after transcript undo failed", error),
      );
      void saveClipperClips(projectId, "ai", snapshot.aiMeta).catch((error) =>
        clipperError("pipeline: save AI clips after transcript undo failed", error),
      );

      const autoPartsClipPreviews = buildClipPreviews(snapshot.autoPartsClips);
      const aiClipPreviews = buildClipPreviews(snapshot.aiClips);
      setState((prev) => ({
        ...prev,
        autoPartsClipPreviews,
        aiClipPreviews,
        clipPreviews: activeClipPreviewsForMode(
          prev.clipSourceMode ?? "auto-parts",
          autoPartsClipPreviews,
          aiClipPreviews,
        ),
      }));
    },
    [aiClipsMetaRef, lastEditedTranscriptRangeRef, projectId, sessionRef, setState],
  );

  const pushClipEditSnapshot = useCallback(() => {
    const snapshot = captureClipEditSnapshot();
    if (!snapshot) return;
    clipEditUndoStackRef.current.push(snapshot);
    if (clipEditUndoStackRef.current.length > CLIP_EDIT_HISTORY_MAX) {
      clipEditUndoStackRef.current.shift();
    }
    clipEditRedoStackRef.current = [];
    setCanUndoClipEdit(true);
    setCanRedoClipEdit(false);
  }, [captureClipEditSnapshot, clipEditRedoStackRef, clipEditUndoStackRef]);

  const editClipTranscript = useCallback(
    (clipIndex: number, op: ClipTranscriptEditOp) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const isAi = (session.clipSourceMode ?? "auto-parts") === "ai";
      const clips = isAi
        ? session.aiClips
        : session.autoPartsClips.length > 0
          ? session.autoPartsClips
          : getActiveClips(session);
      const clip = clips.find((c) => c.index === clipIndex);
      if (!clip) return;

      if (op.type === "copy") {
        const ranges = deriveWordRangesFromClip(clip, session.rangeWords);
        const result = applyClipTranscriptEdit(ranges, op);
        if (result.clipboard?.length) transcriptClipboardRef.current = result.clipboard;
        if (result.editedRange) {
          const edited = { clipIndex, ...result.editedRange };
          lastEditedTranscriptRangeRef.current = edited;
          setLastEditedTranscriptRange(edited);
        }
        return;
      }

      pushClipEditSnapshot();

      const ranges = deriveWordRangesFromClip(clip, session.rangeWords);
      const resolvedOp: ClipTranscriptEditOp =
        op.type === "paste"
          ? { ...op, clipboard: op.clipboard ?? transcriptClipboardRef.current }
          : op;
      const result = applyClipTranscriptEdit(ranges, resolvedOp);

      if (result.clipboard?.length) transcriptClipboardRef.current = result.clipboard;

      if (result.isEmpty) {
        clipEditUndoStackRef.current.pop();
        setCanUndoClipEdit(clipEditUndoStackRef.current.length > 0);
        if (isAi) deleteAiClip(clipIndex);
        else deleteAutoPartsClip(clipIndex);
        lastEditedTranscriptRangeRef.current = null;
        setLastEditedTranscriptRange(null);
        return;
      }

      const label = isAi
        ? aiClipsMetaRef.current.find((c) => c.index === clipIndex)?.label
        : undefined;
      const rebuilt = rebuildClipFromWordRanges(
        clipIndex,
        result.ranges,
        session.rangeWords,
        settings.captions.wordsPerGroup,
        label,
        session.rangeEnd - session.rangeStart,
        undefined,
        session.audioEnvelope ?? undefined,
      );
      const payload = clipPayloadFromWordRanges(
        clipIndex,
        result.ranges,
        session.rangeWords,
        label,
        session.rangeEnd - session.rangeStart,
        undefined,
        session.audioEnvelope ?? undefined,
      );
      if (!rebuilt || !payload) return;

      if (isAi) {
        const nextClips = sortClipsByIndex(
          session.aiClips.map((c) => (c.index === clipIndex ? rebuilt : c)),
        );
        const nextMeta = aiClipsMetaRef.current.map((c) =>
          c.index === clipIndex ? payload : c,
        );
        applyAiClipsAndPersist(nextClips, nextMeta);
      } else {
        const nextClips = sortClipsByIndex(
          clips.map((c) => (c.index === clipIndex ? rebuilt : c)),
        );
        session.autoPartsClips = nextClips;
        syncSessionActiveClips(session);
        session.captionGroupsCache = null;
        void saveClipperClips(
          projectId,
          "auto-parts",
          clipsToPayload(
            nextClips,
            session.rangeWords,
            session.rangeEnd - session.rangeStart,
            session.audioEnvelope ?? undefined,
          ),
        ).catch((error) =>
          clipperError("pipeline: save auto-parts clips after edit failed", error),
        );
        const autoPartsClipPreviews = buildClipPreviews(nextClips);
        setState((prev) => ({
          ...prev,
          autoPartsClipPreviews,
          clipPreviews:
            prev.clipSourceMode !== "ai" ? autoPartsClipPreviews : prev.clipPreviews,
        }));
      }

      if (result.editedRange) {
        const edited = { clipIndex, ...result.editedRange };
        lastEditedTranscriptRangeRef.current = edited;
        setLastEditedTranscriptRange(edited);
      }
    },
    [
      aiClipsMetaRef,
      applyAiClipsAndPersist,
      clipEditUndoStackRef,
      deleteAiClip,
      deleteAutoPartsClip,
      lastEditedTranscriptRangeRef,
      projectId,
      pushClipEditSnapshot,
      sessionRef,
      setState,
      settings.captions.wordsPerGroup,
      transcriptClipboardRef,
    ],
  );

  const undoClipEdit = useCallback(() => {
    const snapshot = clipEditUndoStackRef.current.pop();
    if (!snapshot) return;
    const current = captureClipEditSnapshot();
    if (current) clipEditRedoStackRef.current.push(current);
    restoreClipEditSnapshot(snapshot);
    setCanUndoClipEdit(clipEditUndoStackRef.current.length > 0);
    setCanRedoClipEdit(true);
  }, [
    captureClipEditSnapshot,
    clipEditRedoStackRef,
    clipEditUndoStackRef,
    restoreClipEditSnapshot,
  ]);

  const redoClipEdit = useCallback(() => {
    const snapshot = clipEditRedoStackRef.current.pop();
    if (!snapshot) return;
    const current = captureClipEditSnapshot();
    if (current) clipEditUndoStackRef.current.push(current);
    restoreClipEditSnapshot(snapshot);
    setCanUndoClipEdit(true);
    setCanRedoClipEdit(clipEditRedoStackRef.current.length > 0);
  }, [
    captureClipEditSnapshot,
    clipEditRedoStackRef,
    clipEditUndoStackRef,
    restoreClipEditSnapshot,
  ]);

  return {
    editClipTranscript,
    undoClipEdit,
    redoClipEdit,
    canUndoClipEdit,
    canRedoClipEdit,
    lastEditedTranscriptRange,
  };
}
