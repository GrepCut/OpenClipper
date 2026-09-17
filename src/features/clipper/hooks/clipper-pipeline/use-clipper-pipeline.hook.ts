import { useCallback, useState } from "react";
import { useClipperPipelineAi } from "./use-clipper-pipeline-ai.hook";
import { useClipperPipelineClips } from "./use-clipper-pipeline-clips.hook";
import { useClipperPipelineCore } from "./use-clipper-pipeline-core.hook";
import { useClipperPipelineManual } from "./use-clipper-pipeline-manual.hook";
import { useClipperPipelineRender } from "./use-clipper-pipeline-render.hook";
import { useClipperPipelineWorkflow } from "./use-clipper-pipeline-workflow.hook";
import { useClipperResume } from "../use-clipper-resume.hook";
import { buildFrameContext, buildRangeFrameContext } from "../../pipeline/frame-context.util";
import type { RangeFrameContextGetter } from "../../engine/types/render.types";
import { INITIAL_PIPELINE_STATE } from "./clipper-pipeline.types";
import type { UseClipperPipelineOptions } from "./clipper-pipeline.types";

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
  const { sessionRef, activeClipIndexRef, metadataRef } = refs;

  const workflow = useClipperPipelineWorkflow(core, project, token);
  const clips = useClipperPipelineClips(core);
  const ai = useClipperPipelineAi(core);
  const manual = useClipperPipelineManual(core);
  const render = useClipperPipelineRender(core);

  const [resumeRetryToken, setResumeRetryToken] = useState(0);

  const getRangeFrameContext = useCallback<RangeFrameContextGetter>(
    (range) => {
      const session = sessionRef.current;
      return session ? buildRangeFrameContext(session, settings, range) : null;
    },
    [sessionRef, settings],
  );

  /** Re-arms the resume effect after a phase failed, so it restarts that phase. */
  const retryResume = useCallback(() => {
    refs.resumeStartedRef.current = false;
    core.setState((prev) => ({ ...prev, error: null }));
    void core.persistMetadata({}, "uploading");
    setResumeRetryToken((value) => value + 1);
  }, [core, refs.resumeStartedRef]);

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
    resumeFromTranscribe: workflow.resumeFromTranscribe,
    failPhase: workflow.failPhase,
    activeClipIndexRef,
    retryToken: resumeRetryToken,
  });

  return {
    state,
    settings,
    exportCount: render.exportCount,
    updateSettings,
    resetSettings,
    selectFile: workflow.selectFile,
    confirmRange: workflow.confirmRange,
    retryResume,
    clipAgain: workflow.clipAgain,
    renderExports: render.renderExports,
    existingExports: render.existingExports,
    stopRender: render.stopRender,
    refreshExportHistory: render.refreshExportHistory,
    updateExportMetadata: core.updateExportMetadata,
    reset,
    setActiveClipIndex,
    setClipSourceMode: clips.setClipSourceMode,
    resegmentAutoParts: clips.resegmentAutoParts,
    autoPartsSegmentLengthSec: clips.autoPartsSegmentLengthSec,
    autoPartsResegmenting: clips.autoPartsResegmenting,
    deleteAiClip: ai.deleteAiClip,
    deleteAutoPartsClip: clips.deleteAutoPartsClip,
    upsertManualClip: manual.upsertManualClip,
    deleteManualClip: manual.deleteManualClip,
    getFrameContext: (clipIndex?: number) => {
      const session = sessionRef.current;
      if (!session) return null;
      return buildFrameContext(
        session,
        settings,
        clipIndex ?? activeClipIndexRef.current,
      );
    },
    getRangeFrameContext,
    sourceUrl: sessionRef.current?.sourceUrl ?? null,
    rangeLocked,
    disabledCollageRegionIds: clips.disabledCollageRegionIds,
    toggleCollageRegion: clips.toggleCollageRegion,
  };
}
