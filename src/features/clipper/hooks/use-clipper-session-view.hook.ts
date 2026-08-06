import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { openClipperExportsDir } from "../persistence/export-files.util";
import {
  clipperSessionPath,
  parseClipperSessionView,
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
  const navigate = useNavigate();
  const location = useLocation();
  const canUseAccountFeatures = Boolean(
    auth.user && auth.token && auth.isAuthenticated && auth.sessionMode === "online",
  );

  const view = useMemo(
    () => parseClipperSessionView(location.pathname, project.id),
    [location.pathname, project.id],
  );

  const setView = useCallback(
    (next: SessionViewMode) => {
      navigate(clipperSessionPath(project.id, next));
    },
    [navigate, project.id],
  );

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
    updateExportMetadata,
    reset,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    deleteAiClip,
    deleteAutoPartsClip,
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
    isRendering,
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

  const goToPreview = useCallback(() => setView("preview"), [setView]);
  const goToRenderQueue = useCallback(() => setView("queue"), [setView]);
  const goToExports = useCallback(() => setView("exports"), [setView]);

  const step = useMemo(
    () => resolveClipperSessionStep(state.stage, view, isRendering),
    [state.stage, view, isRendering],
  );

  const visibility = useMemo(
    () =>
      resolveClipperSessionVisibility({
        stage: state.stage,
        view,
        isRendering,
        exportCount,
        loaded,
        clipPreviewsLength: state.clipPreviews.length,
        autoPartsClipPreviewsLength: state.autoPartsClipPreviews?.length,
        rangeTrimmedVideoUrl: state.rangeTrimmedVideoUrl,
        onBackToPreview: goToPreview,
        onBackToRenderQueue: goToRenderQueue,
      }),
    [
      state.stage,
      view,
      isRendering,
      exportCount,
      loaded,
      state.clipPreviews.length,
      state.autoPartsClipPreviews?.length,
      state.rangeTrimmedVideoUrl,
      goToPreview,
      goToRenderQueue,
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
    updateExportMetadata,
    reset,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    deleteAiClip,
    deleteAutoPartsClip,
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
