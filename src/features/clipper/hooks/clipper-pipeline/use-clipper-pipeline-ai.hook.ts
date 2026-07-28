import { useCallback, useState } from "react";

import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import {
  aiClipPicksToWordRanges,
  buildClipsFromWordRanges,
} from "../../engine/transcript";
import {
  resolveActiveClipIndexAfterDelete,
  sortClipsByIndex,
} from "../../engine/segmentation";
import { saveClipperClips, type ClipperClipPayload } from "../../persistence/clipper-clips-api.util";
import {
  clipperAiClipService,
  type ClipperAiChatMessage,
  type ClipperAiClipPick,
  type ClipperAiClipPickerModel,
} from "../../persistence/ai-clip-api.util";
import { syncSessionActiveClips } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import { buildClipPreviews, payloadClipToWordSegments } from "./clip-preview.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineAi(core: UseClipperPipelineCoreResult) {
  const { projectId, setState, settings, refs, persistMetadata } = core;
  const { sessionRef, activeClipIndexRef, aiClipsMetaRef, aiChatAbortRef } = refs;
  const wordsPerGroup = captionWordsPerGroup(settings.captions);

  const [aiChatMessages, setAiChatMessages] = useState<ClipperAiChatMessage[]>([]);
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatError, setAiChatError] = useState<string | null>(null);
  const [aiChatThinking, setAiChatThinking] = useState("");
  const [aiChatProgressChars, setAiChatProgressChars] = useState(0);
  const [aiChatModel, setAiChatModel] = useState<ClipperAiClipPickerModel>("deepseek-v4-flash");

  const loadAiChatHistory = useCallback(async () => {
    try {
      const messages = await clipperAiClipService.getChatHistory(projectId);
      setAiChatMessages(messages);
      setAiChatError(null);
    } catch (error) {
      clipperError("pipeline: AI chat history load failed", error);
      setAiChatError(
        error instanceof Error ? error.message : "Could not load AI chat history.",
      );
    }
  }, [projectId]);

  const startNewAiChat = useCallback(async () => {
    try {
      await clipperAiClipService.clearChatHistory(projectId);
      setAiChatMessages([]);
      setAiChatError(null);
    } catch (error) {
      clipperError("pipeline: AI chat clear failed", error);
      setAiChatError(
        error instanceof Error ? error.message : "Could not start a new chat.",
      );
    }
  }, [projectId]);

  const applyAiClipsAndPersist = useCallback(
    (
      aiClips: ReturnType<typeof buildClipsFromWordRanges>,
      aiGeneratedClips: ClipperClipPayload[],
    ) => {
      const session = sessionRef.current;
      if (!session) return;

      session.aiClips = sortClipsByIndex(aiClips);
      if (session.clipSourceMode === "ai") {
        syncSessionActiveClips(session);
      }

      const sortedMeta = [...aiGeneratedClips].sort((a, b) => a.index - b.index);
      aiClipsMetaRef.current = sortedMeta;
      void saveClipperClips(projectId, "ai", sortedMeta).catch((error) =>
        clipperError("pipeline: save AI clips failed", error),
      );

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

  const applyAiClipResult = useCallback(
    (clips: ClipperAiClipPick[]) => {
      const session = sessionRef.current;
      if (!session) return;

      const aiClips = buildClipsFromWordRanges(
        session.rangeWords,
        aiClipPicksToWordRanges(clips),
        wordsPerGroup,
        session.rangeEnd - session.rangeStart,
        undefined,
        session.audioEnvelope ?? undefined,
      );

      const aiGeneratedClips: ClipperClipPayload[] = aiClips.map((builtClip) => {
        const pick = clips.find((clip) => clip.index === builtClip.index)!;
        return {
          index: builtClip.index,
          startSec: builtClip.startSec,
          endSec: builtClip.endSec,
          label: pick.label,
          segments: builtClip.segments.map((segment, orderIndex) => ({
            orderIndex,
            ...segment,
            wordStartIdx: pick.segments[orderIndex]!.wordStartIdx,
            wordEndIdx: pick.segments[orderIndex]!.wordEndIdx,
          })),
        };
      });

      applyAiClipsAndPersist(aiClips, aiGeneratedClips);
    },
    [applyAiClipsAndPersist, sessionRef, wordsPerGroup],
  );

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

  const sendAiClipChatMessage = useCallback(
    async (message: string, options?: { preset?: string }) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const trimmed = message.trim();
      if (!trimmed) return;

      aiChatAbortRef.current?.abort();
      const abortController = new AbortController();
      aiChatAbortRef.current = abortController;

      setAiChatLoading(true);
      setAiChatError(null);
      setAiChatThinking("");
      setAiChatProgressChars(0);

      try {
        const currentClips = aiClipsMetaRef.current
          .map((clip) => ({
            segments: payloadClipToWordSegments(clip),
            label: clip.label,
          }))
          .filter((clip) => clip.segments.length > 0);

        let streamError: string | null = null;

        await clipperAiClipService.sendChatMessageStream(
          projectId,
          {
            message: trimmed,
            model: aiChatModel,
            preset: options?.preset,
            words: session.rangeWords,
            currentClips: currentClips?.length ? currentClips : undefined,
          },
          {
            onUserMessage: (userMessage) => {
              setAiChatMessages((prev) => [...prev, userMessage]);
            },
            onThinkingDelta: (delta) => {
              setAiChatThinking((prev) => prev + delta);
            },
            onProgress: (chars) => {
              setAiChatProgressChars(chars);
            },
            onDone: (result) => {
              setAiChatMessages((prev) => [...prev, result.assistantMessage]);
              applyAiClipResult(result.clips);
            },
            onError: (message) => {
              streamError = message;
            },
          },
          abortController.signal,
        );

        if (streamError) {
          setAiChatError(streamError);
        }
      } catch (error) {
        if (abortController.signal.aborted) return;
        clipperError("pipeline: AI clip chat failed", error);
        setAiChatError(
          error instanceof Error ? error.message : "AI clip picking failed.",
        );
      } finally {
        if (aiChatAbortRef.current === abortController) {
          aiChatAbortRef.current = null;
        }
        setAiChatLoading(false);
        setAiChatThinking("");
        setAiChatProgressChars(0);
      }
    },
    [aiChatAbortRef, aiChatModel, aiClipsMetaRef, applyAiClipResult, projectId, sessionRef],
  );

  return {
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    setAiChatModel,
    loadAiChatHistory,
    startNewAiChat,
    applyAiClipsAndPersist,
    deleteAiClip,
    sendAiClipChatMessage,
  };
}
