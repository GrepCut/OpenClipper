import { useMemo } from "react";

import { buildFrameContext } from "../../pipeline/session.util";
import { INITIAL_PIPELINE_STATE } from "./clipper-pipeline.types";
import { payloadClipToWordSegments } from "./clip-preview.util";
import type { UseClipperPipelineOptions } from "./clipper-pipeline.types";
import { useClipperPipelineAi } from "./use-clipper-pipeline-ai.hook";
import { useClipperPipelineClips } from "./use-clipper-pipeline-clips.hook";
import { useClipperPipelineCore } from "./use-clipper-pipeline-core.hook";
import { useClipperPipelineRender } from "./use-clipper-pipeline-render.hook";
import { useClipperPipelineWorkflow } from "./use-clipper-pipeline-workflow.hook";
import { useClipperResume } from "../use-clipper-resume.hook";

export function useClipperPipeline({ project, token, loaded }: UseClipperPipelineOptions) {
  const core = useClipperPipelineCore(project, loaded);
  const {
    state,
    settings,
    refs,
    rangeLocked,
    updateSettings,
    resetSettings,
    reset,
    setActiveClipIndex,
  } = core;
  const { sessionRef, activeClipIndexRef, metadataRef, aiClipsMetaRef } = refs;

  const workflow = useClipperPipelineWorkflow(core, project, token);
  const clips = useClipperPipelineClips(core);
  const ai = useClipperPipelineAi(core);
  const render = useClipperPipelineRender(core);

  useClipperResume({
    loaded,
    projectId: project.id,
    setState: core.setState,
    setSettingsState: core.setSettingsState,
    setRangeLocked: core.setRangeLocked,
    metadataRef,
    sessionRef,
    abortRef: refs.abortRef,
    resumeStartedRef: refs.resumeStartedRef,
    loadedResumeKeyRef: refs.loadedResumeKeyRef,
    reporter: refs.reporterRef.current,
    initialState: INITIAL_PIPELINE_STATE,
    preparePreviewFromRange: workflow.preparePreviewFromRange,
    confirmRange: workflow.confirmRange,
    activeClipIndexRef,
  });

  const aiCurrentClipsJsonChars = useMemo(() => {
    const payload = aiClipsMetaRef.current.map((clip) => ({
      segments: payloadClipToWordSegments(clip),
      label: clip.label,
    }));
    return JSON.stringify(payload).length;
  }, [aiClipsMetaRef, state.aiClipPreviews]);

  return {
    state,
    settings,
    exportCount: render.exportCount,
    updateSettings,
    resetSettings,
    selectFile: workflow.selectFile,
    confirmRange: workflow.confirmRange,
    clipAgain: workflow.clipAgain,
    renderExports: render.renderExports,
    rerenderFormat: render.rerenderFormat,
    refreshExportHistory: render.refreshExportHistory,
    updateExportMetadata: core.updateExportMetadata,
    reset,
    download: render.download,
    setActiveClipIndex,
    setClipSourceMode: clips.setClipSourceMode,
    resegmentAutoParts: clips.resegmentAutoParts,
    autoPartsSegmentLengthSec: clips.autoPartsSegmentLengthSec,
    autoPartsResegmenting: clips.autoPartsResegmenting,
    loadAiChatHistory: ai.loadAiChatHistory,
    sendAiClipChatMessage: ai.sendAiClipChatMessage,
    startNewAiChat: ai.startNewAiChat,
    deleteAiClip: ai.deleteAiClip,
    deleteAutoPartsClip: clips.deleteAutoPartsClip,
    aiChatMessages: ai.aiChatMessages,
    aiChatLoading: ai.aiChatLoading,
    aiChatError: ai.aiChatError,
    aiChatThinking: ai.aiChatThinking,
    aiChatProgressChars: ai.aiChatProgressChars,
    aiChatModel: ai.aiChatModel,
    setAiChatModel: ai.setAiChatModel,
    aiCurrentClipsJsonChars,
    getFrameContext: () => {
      const session = sessionRef.current;
      if (!session) return null;
      return buildFrameContext(session, settings, activeClipIndexRef.current);
    },
    sourceUrl: sessionRef.current?.sourceUrl ?? null,
    rangeLocked,
    disabledCollageRegionIds: clips.disabledCollageRegionIds,
    toggleCollageRegion: clips.toggleCollageRegion,
  };
}
