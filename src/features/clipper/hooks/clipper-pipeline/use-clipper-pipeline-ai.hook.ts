import { useCallback, useEffect, useRef } from "react";

import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import { buildClipsFromWordRanges } from "../../engine/transcript";
import {
  resolveActiveClipIndexAfterDelete,
  sortClipsByIndex,
} from "../../engine/segmentation";
import {
  fetchClipperClips,
  saveClipperClips,
  type ClipperClipPayload,
} from "../../persistence/clipper-clips-api.util";
import {
  aiClipsVisuallyEqual,
  CLIPPER_AI_CLIPS_EXTERNAL_SYNC_MS,
} from "../../persistence/clipper-ai-clips-sync.util";
import { syncSessionActiveClips } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import {
  buildClipPreviews,
  payloadClipToWordSegments,
  rebuildClipsFromDbPayload,
} from "./clip-preview.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineAi(core: UseClipperPipelineCoreResult) {
  const { projectId, setState, settings, refs, persistMetadata, state } = core;
  const { sessionRef, activeClipIndexRef, aiClipsMetaRef } = refs;
  const wordsPerGroup = captionWordsPerGroup(settings.captions);
  const syncingRef = useRef(false);

  const applyAiClipsAndPersist = useCallback(
    (
      aiClips: ReturnType<typeof buildClipsFromWordRanges>,
      aiGeneratedClips: ClipperClipPayload[],
      options?: { persist?: boolean },
    ) => {
      const session = sessionRef.current;
      if (!session) return;

      session.aiClips = sortClipsByIndex(aiClips);
      if (session.clipSourceMode === "ai") {
        syncSessionActiveClips(session);
      }

      const sortedMeta = [...aiGeneratedClips].sort((a, b) => a.index - b.index);
      aiClipsMetaRef.current = sortedMeta;
      if (options?.persist !== false) {
        void saveClipperClips(projectId, "ai", sortedMeta).catch((error) =>
          clipperError("pipeline: save AI clips failed", error),
        );
      }

      const aiClipPreviews = buildClipPreviews(session.aiClips);
      setState((prev) => {
        const sorted = session.aiClips;
        const nextActive =
          prev.clipSourceMode === "ai"
            ? sorted.some((clip) => clip.index === prev.activeClipIndex)
              ? prev.activeClipIndex
              : sorted[0]?.index ?? 0
            : prev.activeClipIndex;
        if (prev.clipSourceMode === "ai") {
          activeClipIndexRef.current = nextActive;
          session.activeClipIndex = nextActive;
        }
        return {
          ...prev,
          aiClipPreviews,
          clipPreviews:
            prev.clipSourceMode === "ai" ? aiClipPreviews : prev.clipPreviews,
          activeClipIndex: nextActive,
        };
      });
    },
    [activeClipIndexRef, aiClipsMetaRef, projectId, sessionRef, setState],
  );

  const applyExternalAiClips = useCallback(
    (dbClips: ClipperClipPayload[]) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const aiClips = rebuildClipsFromDbPayload(
        dbClips,
        session.rangeWords,
        wordsPerGroup,
        session.rangeEnd - session.rangeStart,
        session.audioEnvelope ?? undefined,
      );
      applyAiClipsAndPersist(aiClips, dbClips, { persist: false });
    },
    [applyAiClipsAndPersist, sessionRef, wordsPerGroup],
  );

  useEffect(() => {
    if (state.clipSourceMode !== "ai") return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || syncingRef.current) return;
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      syncingRef.current = true;
      try {
        const dbClips = await fetchClipperClips(projectId, "ai");
        if (cancelled) return;
        if (aiClipsVisuallyEqual(aiClipsMetaRef.current, dbClips)) return;
        applyExternalAiClips(dbClips);
      } catch (error) {
        clipperError("pipeline: AI clips external sync failed", error);
      } finally {
        syncingRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, CLIPPER_AI_CLIPS_EXTERNAL_SYNC_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    aiClipsMetaRef,
    applyExternalAiClips,
    projectId,
    sessionRef,
    state.clipSourceMode,
  ]);

  const deleteAiClip = useCallback(
    (index: number) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const previousActive = activeClipIndexRef.current;
      const remainingMeta = [...aiClipsMetaRef.current]
        .filter((clip) => clip.index !== index)
        .sort((a, b) => a.index - b.index);

      const aiClips = sortClipsByIndex(
        buildClipsFromWordRanges(
          session.rangeWords,
          remainingMeta.map((clip) => ({
            segments: payloadClipToWordSegments(clip),
            label: clip.label,
            index: clip.index,
          })),
          wordsPerGroup,
          session.rangeEnd - session.rangeStart,
          undefined,
          session.audioEnvelope ?? undefined,
        ),
      );

      applyAiClipsAndPersist(aiClips, remainingMeta);

      const nextActive = resolveActiveClipIndexAfterDelete(previousActive, index, aiClips);
      activeClipIndexRef.current = nextActive;
      session.activeClipIndex = nextActive;
      setState((prev) => ({ ...prev, activeClipIndex: nextActive }));
      persistMetadata({ activeClipIndex: nextActive });
    },
    [
      activeClipIndexRef,
      aiClipsMetaRef,
      applyAiClipsAndPersist,
      persistMetadata,
      sessionRef,
      setState,
      wordsPerGroup,
    ],
  );

  return {
    applyAiClipsAndPersist,
    deleteAiClip,
  };
}
