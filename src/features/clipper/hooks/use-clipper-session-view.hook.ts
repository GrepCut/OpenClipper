import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { openClipperExportsDir } from "../persistence/export-files.util";
import {
  resolveClipperSessionStep,
  resolveClipperSessionVisibility,
} from "../shared/clipper-session-layout.util";
import type { ClipperSessionViewProps, SessionViewMode } from "../shared/clipper-session-view.types";
import { getSessionExportResults } from "../shared/export-results.util";
import { resumeStepsForStage } from "../shared/loading-status.util";
import { isClipperActivelyRendering } from "../shared/stages.util";
import { useClipperPipeline } from "./use-clipper-pipeline.hook";
import { useClipperRenderQueue } from "./use-clipper-render-queue.hook";
import { useClipperSessionPublish } from "./use-clipper-session-publish.hook";

export function useClipperSessionView({ project, token, loaded }: ClipperSessionViewProps) {
  const auth = useAuth();
  const canUseAccountFeatures = Boolean(
    auth.user && auth.token && auth.isAuthenticated && auth.sessionMode === "online",
  );

  const [view, setView] = useState<SessionViewMode>("preview");

  const pipeline = useClipperPipeline({ project, token, loaded });
  const {
    state,
    settings,
    exportCount,
    updateSettings,
    selectFile,
    confirmRange,
    renderExports,
    rerenderFormat,
    refreshExportHistory,
    reset,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    loadAiChatHistory,
    sendAiClipChatMessage,
    startNewAiChat,
    deleteAiClip,
    deleteAutoPartsClip,
    editClipTranscript,
    undoClipEdit,
    redoClipEdit,
    canUndoClipEdit,
    canRedoClipEdit,
    lastEditedTranscriptRange,
    aiCurrentClipsJsonChars,
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    setAiChatModel,
    sourceUrl,
    rangeLocked,
    disabledCollageRegionIds,
    toggleCollageRegion,
  } = pipeline;

  const isRendering = isClipperActivelyRendering(state.clipPreviews, state.stage);

  const sessionResults = useMemo(
    () => getSessionExportResults(state.clipPreviews),
    [state.clipPreviews],
  );

  const clipIndices = useMemo(
    () => state.clipPreviews.map((preview) => preview.clip.index),
    [state.clipPreviews],
  );

  const renderQueue = useClipperRenderQueue({
    projectId: project.id,
    loaded,
    clipIndices,
    clipPreviews: state.clipPreviews,
    enabledFormatIds: settings.formats.enabledFormatIds,
    isRendering,
    sessionResultsLength: sessionResults.length,
    view,
    setView,
    renderExports,
  });

  const publish = useClipperSessionPublish({
    projectId: project.id,
    canUseAccountFeatures,
  });

  const handleFile = useCallback(
    (file: File) => {
      void selectFile(file);
    },
    [selectFile],
  );

  const handleOpenExportsFolder = useCallback(() => {
    void openClipperExportsDir(project.id).catch(() => {});
  }, [project.id]);

  const goToPreview = useCallback(() => setView("preview"), []);
  const goToExports = useCallback(() => setView("exports"), []);

  const step = useMemo(
    () => resolveClipperSessionStep(state.stage, view, renderQueue.queuePhase),
    [state.stage, view, renderQueue.queuePhase],
  );

  const visibility = useMemo(
    () =>
      resolveClipperSessionVisibility({
        stage: state.stage,
        view,
        queuePhase: renderQueue.queuePhase,
        exportCount,
        loaded,
        clipPreviewsLength: state.clipPreviews.length,
        autoPartsClipPreviewsLength: state.autoPartsClipPreviews?.length,
        rangeTrimmedVideoUrl: state.rangeTrimmedVideoUrl,
        onBackToPreview: goToPreview,
      }),
    [
      state.stage,
      view,
      renderQueue.queuePhase,
      exportCount,
      loaded,
      state.clipPreviews.length,
      state.autoPartsClipPreviews?.length,
      state.rangeTrimmedVideoUrl,
      goToPreview,
    ],
  );

  const resumeLoadingStatus = useMemo(
    () => resumeStepsForStage(state.stage, state.stageMessage),
    [state.stage, state.stageMessage],
  );

  return {
    project,
    state,
    settings,
    exportCount,
    updateSettings,
    confirmRange,
    rerenderFormat,
    refreshExportHistory,
    reset,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    loadAiChatHistory,
    sendAiClipChatMessage,
    startNewAiChat,
    deleteAiClip,
    deleteAutoPartsClip,
    editClipTranscript,
    undoClipEdit,
    redoClipEdit,
    canUndoClipEdit,
    canRedoClipEdit,
    lastEditedTranscriptRange,
    aiCurrentClipsJsonChars,
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    setAiChatModel,
    sourceUrl,
    rangeLocked,
    disabledCollageRegionIds,
    toggleCollageRegion,
    isRendering,
    sessionResults,
    handleFile,
    handleOpenExportsFolder,
    goToExports,
    step,
    visibility,
    resumeLoadingStatus,
    canUseAccountFeatures,
    renderQueue,
    publish,
  };
}
